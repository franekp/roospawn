import * as vscode from 'vscode';
import { IClineController, Message, MessagesRx } from './cline_controller';
import { Task } from './roospawn';


export class Worker {
    /** Whether the worker is active. */
    public active: boolean = true;

    /**
     * A function that wakes up the worker.
     * Call it when there is a chance that the worker can take the next task to run.
     */
    public wakeup?: () => void;

    /** How much time to wait for keepalive signal before aborting the currently running task. */
    private _timeoutMs: number | 'no_timeout' = 'no_timeout';

    /** The timeout object, so we can cancel current timeout on keepalive signal. */
    private _timeout?: NodeJS.Timeout;

    /**
     * The task that is currently running by the RooSpawn extension.
     * Note, that the worker can have an active task even when the controller is not busy.
     * This happens, for example, when the hooks are running.
     */
    private activeRooSpawnTask?: WeakRef<Task>;

    /**
     * Whether the controller is busy (i.e. it is handling a RooSpawn or user task).
     */
    private _isControllerBusy: boolean;

    /**
     * Transfers the task object from the caller of `startTask` (or `resumeTask`) to the handler of `rootTaskStarted` event.
     */
    private initializedRooSpawnTask?: Task;

    /**
     * When user resumes a RooSpawn task, we quickly abort it and run again via the worker loop.
     * Setting this property will force the worker to run the stored task instead of the one from the queue.
     */
    private forceNextTask?: Task;

    constructor(
        private readonly tasks: Task[] = [],
        private readonly nextTaskFromQueue: () => Task | undefined,
        private readonly scheduleUiRepaint: () => void,
        private readonly clineController: IClineController,
        private readonly outputChannel: vscode.OutputChannel,
    ) {
        this.clineController.on('rootTaskStarted', this.onRootTaskStarted.bind(this));
        this.clineController.on('rootTaskEnded', this.onRootTaskEnded.bind(this));
        this.clineController.on('keepalive', this.onKeepalive.bind(this));
        this._isControllerBusy = this.clineController.isBusy();
    }

    async run() {
        while (true) {
            let task: Task | undefined = undefined;
            try {
                while ((task = this.taskToRunIfWeCan()) === undefined) {
                    await new Promise<void>(resolve => { this.wakeup = resolve; });
                    this.wakeup = undefined;
                }

                this.activeRooSpawnTask = new WeakRef(task);

                task.status = 'running';
                this.scheduleUiRepaint();

                // Abort tasks run in the controller, so we have a clean state when we start our new task.
                await this.clineController.abortTaskStack();

                const isResuming = await this.clineController.canResumeTask(task);

                const hookResult = await task.runHook(isResuming ? 'onresume' : 'onstart');
                if (hookResult.failed) {
                    task.status = 'error';
                    this.scheduleUiRepaint();
                    continue;  // move on to the next task
                }
                
                if (isResuming) {
                    this.timeoutMs = 300 * 1000;
                    this.initializedRooSpawnTask = task;
                    await this.clineController.resumeTask(task);
                    // when resuming, we don't need to handle messages, because the "thread"
                    // that handles messages has been started when the task was started and
                    // it will continue to handle messages.
                } else {
                    this.timeoutMs = 10 * 1000;
                    this.initializedRooSpawnTask = task;
                    const channel = await this.clineController.startTask(task);
                    // we don't await handleTaskMessages(), message handling is
                    // a separate "thread", independent from the worker
                    this.handleTaskMessages(new WeakRef(task), channel);
                }
            } catch (e) {
                if (task !== undefined) {
                    task.status = 'error';
                    this.scheduleUiRepaint();
                    console.error(`Error in RooSpawn task #${task.id}`, e);
                } else {
                    console.error('Error in RooSpawn', e);
                }
                this.activeRooSpawnTask = undefined;
            }
        }
    }

    private async handleTaskMessages(task: WeakRef<Task>, rx: MessagesRx) {
        let msg: IteratorResult<Message, void>;
        while (!(msg = await rx.next()).done) {
            const value = msg.value as Message;

            console.log('message', value);

            if (value.type === 'exitMessageHandler') {
                return;
            }

            let t = task.deref();
            if (t === undefined) {
                // The task object has been removed
                if (this.activeRooSpawnTask?.deref() === undefined) {
                    this.activeRooSpawnTask = undefined;
                    this.wakeup?.();
                    this.scheduleUiRepaint();
                }
                return;
            }
            
            if (value.type === 'status') {
                switch (value.status) {
                    case 'completed':
                        const hookResult1 = await t.runHook('oncomplete');
                        if (hookResult1.failed) {
                            t.status = 'error';
                        } else {
                            t.status = 'completed';
                        }
                        break;
                    case 'aborted':
                        if (t.status !== 'running') {
                            return;
                        }
                        const hookResult2 = await t.runHook('onpause');
                        t.status = hookResult2.failed ? 'error' : (this.clineController.isAsking() ? 'asking' : 'aborted');
                        break;
                    case 'error':
                        t.status = 'error';
                        break;
                }
                if (t === this.activeRooSpawnTask?.deref()) {
                    this.activeRooSpawnTask = undefined;
                    this.wakeup?.();
                }
                this.scheduleUiRepaint();
            } else {
                t.conversation.push(value);
            }
        }
    }

    /** Returns a task if there is one, and the controller can run it. */
    private taskToRunIfWeCan(): Task | undefined {
        if (this.isBusy) {
            return undefined;
        }

        if (this.forceNextTask !== undefined) {
            // We run forced task even when the worker is inactive, because the user asked to run this task.
            const task = this.forceNextTask;
            this.forceNextTask = undefined;
            return task;
        }

        if (!this.active) {
            return undefined;
        }

        return this.nextTaskFromQueue();
    }

    /**
     * Returns whether the worker can run a new task.
     * Note, that we have two kinds of beeing busy:
     * 
     * 1. The controller can be busy, because it is handling a RooSpawn or user task.
     * 2. The worker can be busy, because it is running a task (or its hooks).
     * 
     * Controller reports busyness via `isBusy` property and `rootTaskStarted`/`rootTaskEnded`
     * events.
     * 
     * Worker starts being busy when it takes next task from the queue and ends when it runs
     * `onpause`/`oncomplete` hook.
     */
    get isBusy(): boolean {
        return this._isControllerBusy || this.activeRooSpawnTask !== undefined;
    }

    get timeoutMs(): number | 'no_timeout' {
        return this._timeoutMs;
    }

    set timeoutMs(milliseconds: number | 'no_timeout') {
        this._timeoutMs = milliseconds;
        this.onKeepalive();
    }

    onKeepalive() {
        if (this._timeout !== undefined) {
            clearTimeout(this._timeout);
            this._timeout = undefined;
        }

        if (this.isBusy && this._timeoutMs !== 'no_timeout') {
            this._timeout = setTimeout(() => this.onTimeout(), this._timeoutMs);
        }
    }
    
    private async onTimeout() {
        this.onKeepalive();

        const task = this.activeRooSpawnTask?.deref();
        await this.clineController.abortTaskStack();
        if (task === undefined) {
            // In this case, activeRooSpawnTask will not be cleared by message handler,
            // because the task is already deleted.
            this.activeRooSpawnTask = undefined;
            this.wakeup?.();
            this.scheduleUiRepaint();
        }
        
        this.timeoutMs = 'no_timeout';        
    }

    private async onRootTaskStarted(clineTaskId: string) {
        this._isControllerBusy = true;

        if (this.initializedRooSpawnTask !== undefined) {
            // This is a RooSpawn task that was started or resumed by the RooSpawn extension.
            this.initializedRooSpawnTask.clineId = clineTaskId;
            this.initializedRooSpawnTask = undefined;
        } else {
            const task = this.tasks.find(t => t.clineId === clineTaskId);
            if (task !== undefined) {
                // This is RooSpawn task resumed by the user via Roo-Code,
                // so lets quickly abort it and run again via worker loop.
                this.forceNextTask = task;
                await this.clineController.abortTaskStack();
                this.wakeup?.();
            } else {
                // This is user task
                this.timeoutMs = 'no_timeout';
            }
        }
    }

    private onRootTaskEnded(clineTaskId: string) {
        this._isControllerBusy = false;
        this.wakeup?.();
    }
}
