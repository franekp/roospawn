import * as vscode from 'vscode';
import { IClineController, Message, MessagesRx } from './cline_controller';
import { Task } from './roospawn';


export class Worker {
    public active: boolean = true;
    public wakeup?: () => void;

    // Timeout for currently running task
    private _timeoutMs: number | 'no_timeout' = 'no_timeout';
    private _timeout?: NodeJS.Timeout;

    // Note, that the RooSpawn task is active even when the controller is not busy
    // (e.g. when the hooks are running).
    private activeRooSpawnTask?: WeakRef<Task>;
    private _isControllerBusy: boolean;
    private initializedRooSpawnTask?: Task;

    // When user resumes a RooSpawn task, we quickly abort it and run again via worker loop.
    // Setting this property will force the worker to run this task instead of the one from the queue.
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

                console.info("Running task", task);
                this.activeRooSpawnTask = new WeakRef(task);

                task.status = 'running';
                this.scheduleUiRepaint();

                // Abort all tasks, so we have a clean state when we start our new task.
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

    get isBusy(): boolean {
        console.log("isBusy", this._isControllerBusy, this.activeRooSpawnTask);
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
        if (task !== undefined) {
            await this.clineController.abortTaskStack();
        } else {
            await this.clineController.abortTaskStack();
            this.activeRooSpawnTask = undefined;
            this.wakeup?.();
            this.scheduleUiRepaint();
        }
        
        this.timeoutMs = 'no_timeout';        
    }

    private async onRootTaskStarted(clineTaskId: string) {
        this._isControllerBusy = true;

        if (this.initializedRooSpawnTask !== undefined) {
            this.initializedRooSpawnTask.clineId = clineTaskId;
            this.initializedRooSpawnTask = undefined;
        } else {
            console.log("onRootTaskStarted", clineTaskId, this.tasks);
            const task = this.tasks.find(t => t.clineId === clineTaskId);
            if (task !== undefined) {
                // This is RooSpawn task resumed by the user via Roo-Code, so lets quickly abort it and run again via worker loop.
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
