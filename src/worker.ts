import EventEmitter from 'events';
import * as vscode from 'vscode';
import { Watchdog } from './async_utils';
import { IClineController, Message, MessagesRx } from './cline_controller';
import { Task, Tasks } from './roospawn';


export class Worker {
    /** Whether the worker is active. */
    private _active: boolean = true;

    /**
     * A function that wakes up the worker.
     * Call it when there is a chance that the worker can take the next task to run.
     */
    private _wakeupRooSpawn?: () => void;
    private _onUserStarted?: () => void;
    private _onUserEnded?: () => void;

    private _runningUserTask: boolean;
    private _runningRooSpawnTask: boolean;

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
        private readonly tasks: Tasks,
        private readonly clineController: IClineController,
        private readonly outputChannel: vscode.OutputChannel,
    ) {
        this.clineController.on('rootTaskStarted', this.onRootTaskStarted.bind(this));
        this.clineController.on('rootTaskEnded', this.onRootTaskEnded.bind(this));
        this.tasks.on('update', () => this._wakeupRooSpawn?.());
        this._runningUserTask = this.clineController.isBusy();
    }

    run() {
        this.rooSpawnTaskLoop();
        this.userTaskLoop();
    }

    private async rooSpawnTaskLoop() {
        while (true) {
            let task: Task | undefined = undefined;
            let onControllerKeepalive: () => void | undefined = undefined;
            try {
                while ((task = this.taskToRunIfWeCan()) === undefined) {
                    await new Promise<void>(resolve => { this._wakeupRooSpawn = resolve; });
                    this._wakeupRooSpawn = undefined;
                }

                this._runningRooSpawnTask = true;

                task.status = 'running';
                this.tasks.emit('update');

                // Abort tasks run in the controller, so we have a clean state when we start our new task.
                await this.clineController.abortTaskStack();

                const isResuming = await this.clineController.canResumeTask(task);

                // Note that we do not apply timeout to the hooks here.
                // Each shell command is internally run with timeout, and we hope that this will prevent
                // forever-hanging hooks.
                const hookResult = await task.runHook(isResuming ? 'onresume' : 'onstart');
                if (hookResult.failed) {
                    task.status = 'error';
                    this.tasks.emit('update');
                    continue;  // move on to the next task
                }
                

                // Prepare handlers that will be called when the task is finished.

                let endTaskPromiseResolver: () => void;
                const endTaskPromise = new Promise<void>(resolve => { endTaskPromiseResolver = resolve; });
                let endPostHookPromiseResolver: () => void;
                const endPostHookPromise = new Promise<void>(resolve => { endPostHookPromiseResolver = resolve; });
                const handleStatus = async (status: 'completed' | 'aborted' | 'error') => {
                    endTaskPromiseResolver();
                    let result = undefined;
                    switch (status) {
                        case 'completed':
                            const hookResult1 = await task.runHook('oncomplete');
                            result = hookResult1.failed ? 'error' : 'completed';
                            break;
                        case 'aborted':
                            const hookResult2 = await task.runHook('onpause');
                            result = hookResult2.failed ? 'error' : 'aborted';
                            break;
                        case 'error':
                            result = 'error';
                            break;
                    }

                    endPostHookPromiseResolver();
                    return result;
                };
                
                // Run the task.

                let taskLifecycle: TaskLifecycle;
                this.initializedRooSpawnTask = task;

                if (isResuming) {
                    taskLifecycle = task.taskLifecycle!;
                    taskLifecycle.onStatusMessage = handleStatus;
                    
                    await this.clineController.resumeTask(task);
                    // when resuming, we don't need to handle messages, because the "thread"
                    // that handles messages has been started when the task was started and
                    // it will continue to handle messages.
                } else {
                    const channel = await this.clineController.startTask(task);

                    taskLifecycle = new TaskLifecycle(task, channel);
                    task.taskLifecycle = taskLifecycle;
                    taskLifecycle.onStatusMessage = handleStatus;
                    taskLifecycle.on('status', () => this.tasks.emit('update'));

                    // we don't await handleTaskMessages(), message handling is
                    // a separate "thread", independent from the worker
                    taskLifecycle.runMessageHandler();
                }

                const timeoutMs = isResuming ? 30 * 1000 : 10 * 1000;
                const watchdog = new Watchdog<void>(timeoutMs);

                onControllerKeepalive = () => watchdog.keepalive();
                this.clineController.on('keepalive', onControllerKeepalive);

                const timeoutResult = await watchdog.run(endTaskPromise);

                this.clineController.off('keepalive', onControllerKeepalive);
                onControllerKeepalive = undefined;

                if (timeoutResult.reason === 'timeout') {
                    const hookResult = await task.runHook('onpause');
                    const newStatus = hookResult.failed ? 'error' : 'asking';
                    taskLifecycle.setStatus(newStatus);
                } else {
                    await endPostHookPromise;
                }
            } catch (e) {
                if (task !== undefined) {
                    task.status = 'error';
                    this.tasks.emit('update');
                    console.error(`Error in RooSpawn task #${task.id}`, e);
                } else {
                    console.error('Error in RooSpawn', e);
                }
            } finally {
                if (onControllerKeepalive !== undefined) {
                    this.clineController.off('keepalive', onControllerKeepalive);
                }
                this._runningRooSpawnTask = false;
            }
        }
    }

    private async userTaskLoop() {
        while (true) {
            if (!this._runningUserTask) {
                await new Promise<void>(resolve => { this._onUserStarted = resolve; });
                this._onUserStarted = undefined;
                this._runningUserTask = true;
            }
            
            const waitForEnd = new Promise<void>(resolve => { this._onUserEnded = resolve; });

            // Note: we can apply here some soft timeout to e.g. warn user that some task is blocking RooSpawn.
            await waitForEnd;
            this._onUserEnded = undefined;
            this._runningUserTask = false;
        }
    }

    get active(): boolean {
        return this._active;
    }

    set active(value: boolean) {
        const enabled = value && !this._active;
        this._active = value;
        if (enabled) {
            this._wakeupRooSpawn?.();
        }
    }

    /** Returns a task if there is one, and the controller can run it. */
    private taskToRunIfWeCan(): Task | undefined {
        if (this._runningUserTask) {
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

        return this.tasks.getTask();
    }

    private async onRootTaskStarted(clineTaskId: string) {
        if (this.initializedRooSpawnTask !== undefined) {
            // This is a RooSpawn task that was started or resumed by the RooSpawn extension.
            this.initializedRooSpawnTask.clineId = clineTaskId;
            this.initializedRooSpawnTask = undefined;
        } else {
            const task = this.tasks.getTaskByClineId(clineTaskId);
            if (task !== undefined) {
                // This is RooSpawn task resumed by the user via Roo-Code,
                // so lets quickly abort it and run again via worker loop.
                this.forceNextTask = task;
                // Now (in `onRootTaskStarted`) we are in the sittuation that a new Cline instance
                // was created, but it was not added to the stack yet.
                // We need to wait until it is added to the stack, to proparely abort it.
                await this.clineController.waitForAddingTaskToStack(clineTaskId);
                await this.clineController.abortTaskStack();
                this._wakeupRooSpawn?.();
            } else {
                // This is user task
                this._runningUserTask = true;
                this._onUserStarted?.();
            }
        }
    }

    private onRootTaskEnded(clineTaskId: string) {
        this._runningUserTask = false;
        this._onUserEnded?.();
    }
}

export class TaskLifecycle extends EventEmitter<TaskLifecycleEvent> {
    private task: WeakRef<Task>;
    public onStatusMessage?: (status: 'completed' | 'aborted' | 'error') => Promise<'completed' | 'asking' | 'aborted' | 'error' | undefined>;

    constructor(task: Task, private readonly rx: MessagesRx) {
        super();
        this.task = new WeakRef(task);
    }

    async runMessageHandler() {
        let msg: IteratorResult<Message, void>;
        while (!(msg = await this.rx.next()).done) {
            const value = msg.value as Message;

            let t = this.task.deref();
            if (t === undefined || value.type === 'exitMessageHandler') {
                return;
            }
            
            if (value.type === 'status') {
                const onStatusMessage = this.onStatusMessage;
                this.onStatusMessage = undefined;

                let newStatus = await onStatusMessage?.(value.status);
                if (newStatus !== undefined) {
                    this.setStatus(newStatus, t);
                }
            } else {
                t.conversation.push(value);
            }
        }
    }

    setStatus(status: 'completed' | 'asking' | 'aborted' | 'error', task?: Task) {
        // When we set the status, we don't want to handle status messages anymore.
        this.onStatusMessage = undefined;

        // If task not passed explicitly, extract it from the weak ref.
        task ??= this.task.deref();

        if (task !== undefined) {
            task.status = status;
        }
        this.emit('status', status);
    }
}

type TaskLifecycleEvent = {
    status: [status: 'completed' | 'asking' | 'aborted' | 'error'];
}
