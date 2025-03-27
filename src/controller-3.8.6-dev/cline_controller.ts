import * as vscode from 'vscode';
import { Waiters, Waiter, Channel } from '../async_utils';
import { ClineAsk, ClineMessage, ClineSay, RooCodeAPI } from './roo-code';
import { Task } from '../roospawn';
import { IClineController, Message, MessagesTx, MessagesRx, UserTaskSwitch } from '../cline_controller';
import EventEmitter from 'events';


export interface ControllingTrackerParams {
    channel: MessagesTx;
    timeout: number;
    clineId?: string;
}

// INVARIANT:
//  - Tasks scheduled by Roospawn are always at the root (bottom) of the task stack.
// STATE TRACKING REQUIREMENTS:
//  - We need to track whether Roo Code is busy with some task,
//    - so that we can proceed with remaining queued tasks when it becomes free.
//  - When Roo Code has finished a task, we consider it free.
//  - When Roo Code has asked the user and is waiting for response, we apply a timeout of X seconds.
//    - We wait for X seconds treating Roo Code as busy.
//       - If user has responded, we continue to treat Roo Code as busy, as it continues working on the task.
//    - After X seconds has passed without user response, we consider Roo Code as free and will spawn a new task if there is any in the queue.
//    - Exception: we don't apply this timeout if the current root task has been started by the user, not by Roospawn.
//       - In this case, we wait indefinitely.
//       - Preempting roospawn-started tasks is fine, because we have an "onpause" callback that specifies how to cleanup and stash WIP changes.
//       - Preempting user-started tasks is NOT OK, because user hasn't specified what to do with WIP changes.
//  - As this code is critical for us, we prefer to keep it simple and robust over making it perfect.
//  - Therefore, we settle for an approach that:
//    - sometimes considers Roo Code as free when it is in fact busy (but only for roospawn-started tasks)
//    - but does not rely on inspecting messages from Roo Code (for roospawn-started tasks)
// STATE TRACKING LOGIC:
//  - For user-started tasks, we inspect messages to detect when the task is completed.
//    - Here it is better to err on the side of caution, to not preempt user-started tasks.
//    - We inspect messages to determine whether current task is completed.
//    - If task stack is empty, we consider Roo Code as free.
//    - worth to note that if Roo has marked the task as completed and afterwards is asking to execute some command, then:
//       - we should consider it as free despite the fact that it is waiting for user response, because the task is completed
//       - the command is usually non-essential and can be preempted
//    - However, we might consider **waiting for user closing the task in the UI** (the "terminate" button in chat, or "new task" button at the top of the sidebar)
//       - to allow the user to commit the task's changes
//  - For roospawn-started tasks, we use a keep-alive mechanism (or a time-bound lease) to hold the busy state while the task is running.
//    - Here it is better to err on the side of liveness:
//       - it is better to preempt a roospawn-started task than to block all other tasks in the queue.
//    - We inspect messages to determine whether current task is completed, and set busy flag to false when it is.
//       - Worth to note that this not essential - it only speeds up the detection of completed tasks.
//    - We use a keep-alive mechanism to hold the busy state for X seconds while the task is running.
//       - Any message from the task is considered a keep-alive and extends the busy state for another X seconds.
//       - Therefore, if the task has stopped progressing
//          - be it due to user-ask, completion, hanging API call, hanging tool call, etc.
//          - we will always detect it, set busy flag to false and proceed with remaining tasks from the queue
//       - This way we can ensure that we are always making progress, and never get stuck waiting for a hanging task
// STATE TRACKING IMPLEMENTATION:
//  - We can use the same lease-extending mechanism for both user-started and roospawn-started tasks
//  - User-started tasks will have X = 'no_timeout'
//     - but will still have the completion detection logic described above
//  - Independently of these, we need additional mechanism to detect when the task is terminated (removed from the task stack)
//     - Again, we must prioritize liveness and robustness over perfection
//     - Therefore, I propose that we set up a periodic timer (setInterval, something like every 10s) that'll check if current task stack is empty
//       - if it is, we set the busy flag to false
// BATTERY LIFE CONSIDERATIONS:
//  - Later, we might consider removing all these periodic checks when:
//     - worker is paused
//     - worker is waiting for tasks in the queue

// Subtask notes to add above
// - a subtask is treated as part of its root task
// - and thus we always preempt (cancel) the whole task stack (instead of just the subtask)
// - tasks started by RooSpawn are always the root tasks, although they can spawn subtasks, the task is completed when the root task complets
// - for now we ignore messages from subtasks, in the future we should extend our data structures to support them
// - cline controller becomes not-busy when the processed root task is completed

export class ClineController implements IClineController {
    private rooCodeTasks: Map<string, RooCodeTask> = new Map();
    private rootTasks: Map<string, string> = new Map();
    
    /// We set this flag to `true` when we know that some task is running within controlled `ClineProvider`.
    private busy: BusyManager = new BusyManager();
    private busyToken?: BusyToken;  // TODO: probably stored inside RooCodeTask
    private log: vscode.OutputChannel | undefined;

    // This is set before `startNewTask` or `resumeTask` is called,
    // and used inside `handleTaskStarted` to create a RooCodeTask
    // for newely started task.
    private createRooCodeTask?: (taskId: string) => RooCodeTask;

    private _onUserSwitchedTask: ((taskSwitch: UserTaskSwitch) => {
        timeoutMs: 'no_timeout' | number,
        waitBeforeStart?: Promise<void>
    }) = () => ({ timeoutMs: 'no_timeout' });

    onUserSwitchedTask(handler: (taskSwitch: UserTaskSwitch) => {
        timeoutMs: 'no_timeout' | number,
        waitBeforeStart?: Promise<void>
    }): void {
        this._onUserSwitchedTask = handler;
    }

    constructor(private api: RooCodeAPI, private tasks: Task[], private enableLogging: boolean = false) {
        // attach events to the API
        this.api.on('message', ({ taskId, message }) => this.handleMessage(taskId, message));
        this.api.on('taskCreated', (taskId) => this.handleTaskCreated(taskId));
        this.api.on('taskStarted', (taskId) => this.handleTaskStarted(taskId));
        this.api.on('taskSpawned', (taskId, childTaskId) => this.handleTaskSpawned(taskId, childTaskId));
        this.api.on('taskAskResponded', (taskId) => this.handleTaskAskResponded(taskId));
        this.api.on('taskAborted', (taskId) => this.handleTaskAborted(taskId));
        this.busy.setTimeoutCallback(this.handleTimeout.bind(this));
    
        if (enableLogging) {
            this.setUpLogger();
        }

        if (isRooCodeRunningTask(this.api)) {
            this.busyToken = this.busy.setBusy();
        }
        this.busy.timeoutMs = 10000;
        this.rooCodeTasks = UserTask.fromRooCodeApi(this.api);
    }

    setUpLogger() {
        const log = this.log = vscode.window.createOutputChannel('controller-3.8.6-dev');
        log.appendLine('ClineController initialized');

        this.api.on('message', ({ taskId, message }) => {
            taskId = taskId.slice(0, 6);

            let partial = '';
            let ident = '    ';
            if (message.partial) {
                partial = ' partial';
                ident = '        ';
            }

            if (message.type === 'ask') {
                log.appendLine(`${ident}[${taskId}]${partial} ASK: ${message.ask} (${message.text?.length} chars)`);
            }
            if (message.type === 'say') {
                log.appendLine(`${ident}[${taskId}]${partial} SAY: ${message.say} (${message.text?.length} chars)`);
            }
        });
        this.api.on('taskCreated', (taskId) => {
            log.appendLine(`[${taskId}] taskCreated`);
        });
        this.api.on('taskStarted', (taskId) => {
            log.appendLine(`[${taskId}] taskStarted`);
        });
        this.api.on('taskPaused', (taskId) => {
            log.appendLine(`[${taskId}] taskPaused`);
        });
        this.api.on('taskUnpaused', (taskId) => {
            log.appendLine(`[${taskId}] taskResumed`);
        });
        this.api.on('taskSpawned', (taskId, childTaskId) => {
            log.appendLine(`[${taskId}] taskSpawned ${childTaskId}`);
        });
        this.api.on('taskAskResponded', (taskId) => {
            log.appendLine(`[${taskId}] taskAskResponded`);
        });
        this.api.on('taskAborted', (taskId) => {
            log.appendLine(`[${taskId}] taskAborted`);
        });

        this.busy.on('state', (state) => {
            log.appendLine(`state = ${state}`);
        });
        this.busy.on('timeout', () => {
            log.appendLine(`timeout`);
        });
    }

    waitUntilNotBusy(): Promise<void> {
        return this.busy.waitUntilFree();
    }
    async canResumeTask(task: Task): Promise<boolean> {
        if (task.clineId === undefined) {
            return false;
        }

        return await this.api.isTaskInHistory(task.clineId);
    }
    async resumeTask(task: Task): Promise<void> {
        if (this.busy.isBusy) {
            throw new Error('Cannot resume task while Roo Code is busy');
        }

        const clineId = task.clineId!;
        const tx = task.tx!;

        this.rooCodeTasks.set(clineId, new RooSpawnTask(clineId, 300000, tx));
        await this.api.resumeTask(clineId);
    }
    async startTask(task: Task): Promise<MessagesRx> {
        if (this.busy.isBusy) {
            throw new Error('Cannot start task while Roo Code is busy');
        }

        const { tx, rx } = Channel.create<Message>();
        this.createRooCodeTask = (taskId: string) => new RooSpawnTask(taskId, 20000, tx);
        await this.api.startNewTask(task.prompt);
        return rx;
    }

    handleMessage(taskId: string, message: ClineMessage) {
        this.busy.keepalive();

        if (message.partial) {
            return;
        }

        const rooCodeTask = this.rooCodeTasks.get(taskId);
        if (rooCodeTask === undefined) {
            this.log?.appendLine(`[handleMessage] Unknown task ${taskId}`);
            throw new Error(`Unknown task ${taskId}`);
        } else {
            const postMessage = (message: Message | (() => Message)) => {
                this.log?.appendLine(`[handleMessage] Posting message to task ${rooCodeTask.rootTaskId} of type ${rooCodeTask.type}`);
                if (rooCodeTask.type === 'roospawn') {
                    const msg = typeof message === 'function' ? message() : message;
                    this.log?.appendLine(`Sending message to roospawn task: ${JSON.stringify(msg)}`);
                    rooCodeTask.tx.send(msg);
                }
            };

            postMessage(() => clineMessageToMessage(message));

            const finishesRootTask = message.type === 'say'
                && message.say === 'completion_result'
                && this.api.getCurrentTaskStack().length <= 1;

            if (finishesRootTask) {
                this.log?.appendLine("Finished root task!");
                postMessage({ type: 'status', status: 'completed' });
                this.busy.setFree(this.busyToken!);
            }
        }
    }

    handleTaskCreated(taskId: string) {
        if (!this.rooCodeTasks.has(taskId)) {
            const createTask = this.createRooCodeTask || this.startUserTask.bind(this);
            this.createRooCodeTask = undefined;

            const task = createTask(taskId);
            this.rooCodeTasks.set(taskId, task);
            this.busyToken = this.busy.setBusy();
            
        } // else: this task is a subtask
    }

    handleTaskStarted(taskId: string) {
        const task = this.rooCodeTasks.get(taskId)!;
        if (task.type === 'roospawn') {
            this.busy.timeoutMs = task.timeoutMs;
        } else {
            this.busy.timeoutMs = 'no_timeout';
        }
    }

    handleTaskSpawned(taskId: string, childTaskId: string) {
        const rooCodeTask = this.rooCodeTasks.get(taskId);
        if (rooCodeTask !== undefined) {
            this.rooCodeTasks.set(childTaskId, rooCodeTask);
        }
    }

    handleTaskAskResponded(taskId: string) {
        this.busy.keepalive();
    }

    handleTaskAborted(taskId: string) {
        const rooCodeTask = this.rooCodeTasks.get(taskId);
        if (rooCodeTask === undefined) {
            throw new Error("Aborting unknown task");
        }

        this.rooCodeTasks.delete(taskId);

        if (rooCodeTask.rootTaskId === taskId) {
            if (rooCodeTask.type === 'roospawn') {
                rooCodeTask.tx.send({ type: 'status', status: 'aborted' });
            }

            this.busy.setFree(this.busyToken!);
        }
    }

    private async handleTimeout(evt: TimeoutEvent) {
        await this.abortTaskTree();
    }

    private async abortTaskTree() {
        while (this.api.getCurrentTaskStack().length > 0) {
            const taskId = this.api.getCurrentTaskStack()[this.api.getCurrentTaskStack().length - 1];
            this.log?.appendLine(`Aborting task ${taskId}`);
            this.api.clearCurrentTask();
            this.log?.appendLine(`Task ${taskId} aborted`);
        }
    }

    private startUserTask(taskId: string): RooCodeTask {
        const task = new UserTask(taskId);
        this.busy.timeoutMs = 10000;
        return task;
    }
}

type RooCodeTask = RooSpawnTask | UserTask;

class RooSpawnTask {
    readonly type: 'roospawn' = 'roospawn';
    readonly tx: MessagesTx;
    readonly rootTaskId: string;
    readonly timeoutMs: number | 'no_timeout';

    constructor(rootTaskId: string, timeoutMs: number | 'no_timeout', tx: MessagesTx) {
        this.rootTaskId = rootTaskId;
        this.timeoutMs = timeoutMs;
        this.tx = tx;
    }
}

class UserTask {
    readonly type: 'user' = 'user';
    readonly rootTaskId: string;

    constructor(rootTaskId: string) {
        this.rootTaskId = rootTaskId;
    }

    static fromRooCodeApi(rooCode: RooCodeAPI): Map<string, UserTask> {
        const tasksStack = rooCode.getCurrentTaskStack();

        if (tasksStack.length === 0) {
            return new Map();
        }

        const rootTaskId = tasksStack[0];
        const userTask = new UserTask(rootTaskId);
        return new Map(tasksStack.map(taskId => [taskId, userTask]));
    }
}


function isRooCodeRunningTask(rooCode: RooCodeAPI): boolean {
    const tasksStack = rooCode.getCurrentTaskStack();
    if (tasksStack.length === 0) {
        return false;
    }

    const rootTask = tasksStack[0];
    const messages = rooCode.getMessages(rootTask);
    return !messages.some(m => m.type === 'say' && m.say === 'completion_result');
}

function clineMessageToMessage(message: ClineMessage): Message {
    switch (message.type) {
        case 'say':
            return { type: 'say', say: message.say!, text: message.text, images: message.images };
        case 'ask':
            return { type: 'ask', ask: message.ask!, text: message.text };
    }
}

// Tracks whether Roo Code is busy, handles timeouts, preemption and waiting for free state
class BusyManager extends EventEmitter<BusyManagerEvents> {
    private _timeoutMs: number | 'no_timeout' = 'no_timeout';

    private waiters: Waiters = new Waiters();
    private busyToken?: BusyToken;

    private timeoutCallback?: (evt: TimeoutEvent) => Promise<void>;
    private timeout?: NodeJS.Timeout;

    constructor() {
        super();
    }

    async waitUntilFree(): Promise<void> {
        let waiter = new Waiter(() => !this.isBusy);
        this.waiters.add(waiter);
        await waiter.wait();
    }
    
    get timeoutMs(): number | 'no_timeout' {
        return this._timeoutMs;
    }

    set timeoutMs(milliseconds: number | 'no_timeout') {
        this._timeoutMs = milliseconds;
        this.keepalive();
    }

    keepalive() {
        if (this.timeout !== undefined) {
            clearTimeout(this.timeout);
            this.timeout = undefined;
        }

        if (this.isBusy && this._timeoutMs !== 'no_timeout') {
            this.timeout = setTimeout(() => {
                this.onTimeout();
            }, this._timeoutMs);
        }
    }
    
    get isBusy(): boolean {
        return this.busyToken !== undefined;
    }

    setBusy(): BusyToken {
        this.busyToken = new BusyToken();
        this.keepalive();
        this.emit('state', 'busy');
        return this.busyToken;
    }

    setFree(token: BusyToken) {
        if (this.busyToken === token) {
            if (this.timeout !== undefined) {
                clearTimeout(this.timeout);
                this.timeout = undefined;
            }
            this.busyToken = undefined;
            this.emit('state', 'free');
            this.waiters.wake();
        }
    }

    setTimeoutCallback(callback: (evt: TimeoutEvent) => Promise<void>) {
        this.timeoutCallback = callback;
    }

    private async onTimeout() {
        if (this.busyToken === undefined) {
            return;
        }
        const busyToken = this.busyToken;
        this.emit('timeout');

        let evt = new TimeoutEvent();
        await this.timeoutCallback?.(evt);
        if (evt.isPreventingPreemption()) {
            this.keepalive();
        } else {
            this.setFree(busyToken);
        }
    }
}

class BusyToken {}

type BusyManagerEvents = {
    state: ['busy'|'free'];
    timeout: [];
}

class TimeoutEvent {
    private _preventPreemption: boolean = false;

    preventPreemption() {
        this._preventPreemption = true;
    }

    isPreventingPreemption(): boolean {
        return this._preventPreemption;
    }
}
