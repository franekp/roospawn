import * as vscode from 'vscode';
import { Waiters, Waiter, Channel } from '../async_utils';
import { ClineAsk, ClineMessage, ClineSay, RooCodeAPI } from './roo-code';
import { Task } from '../roospawn';
import { IClineController, Message, MessagesTx, MessagesRx, ControllerEvents } from '../cline_controller';
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

export class ClineController extends EventEmitter<ControllerEvents> implements IClineController {
    private rooCodeTasks: Map<string, RooCodeTask> = new Map();
    
    private log: vscode.OutputChannel | undefined;
    private _isBusy: boolean;
    private _isAsking: boolean;

    // This is set before `startNewTask` or `resumeTask` is called,
    // and used inside `handleTaskStarted` to create a RooCodeTask
    // for newely started task.
    private createRooCodeTask?: (taskId: string) => RooCodeTask;

    constructor(private api: RooCodeAPI, private tasks: Task[], private enableLogging: boolean = false) {
        super();

        // attach events to the API
        this.api.on('message', ({ taskId, message }) => this.handleMessage(taskId, message));
        this.api.on('taskCreated', (taskId) => this.handleTaskCreated(taskId));
        this.api.on('taskSpawned', (taskId, childTaskId) => this.handleTaskSpawned(taskId, childTaskId));
        this.api.on('taskAskResponded', (taskId) => this.handleTaskAskResponded(taskId));
        this.api.on('taskAborted', (taskId) => this.handleTaskAborted(taskId));
    
        if (enableLogging) {
            this.setUpLogger();
        }

        this._isBusy = isRooCodeRunningTask(this.api);
        this.rooCodeTasks = userTasksFromApi(this.api);
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
    }

    async canResumeTask(task: Task): Promise<boolean> {
        if (task.clineId === undefined) {
            return false;
        }

        return await this.api.isTaskInHistory(task.clineId);
    }
    async resumeTask(task: Task): Promise<void> {
        if (this._isBusy) {
            throw new Error('Cannot resume task while Roo Code is busy');
        }

        const clineId = task.clineId!;
        const tx = task.tx!;

        this.rooCodeTasks.set(clineId, { type: 'roospawn', rootTaskId: clineId, tx });
        this.createRooCodeTask = (taskId: string) => ({ type: 'roospawn', rootTaskId: taskId, tx });
        await this.api.setConfiguration({ mode: task.mode });
        await this.api.resumeTask(clineId);
    }
    async startTask(task: Task): Promise<MessagesRx> {
        if (this._isBusy) {
            throw new Error('Cannot start task while Roo Code is busy');
        }

        const { tx, rx } = Channel.create<Message>();
        task.tx = tx;
        this.createRooCodeTask = (taskId: string) => {
            task.clineId = taskId;
            return { type: 'roospawn', rootTaskId: taskId, tx };
        };
        await this.api.setConfiguration({ mode: task.mode });
        await this.api.startNewTask(task.prompt);
        return rx;
    }

    async abortTaskStack() {
        while (this.api.getCurrentTaskStack().length > 0) {
            const taskId = this.api.getCurrentTaskStack()[this.api.getCurrentTaskStack().length - 1];
            this.log?.appendLine(`Aborting task ${taskId}`);
            this.api.clearCurrentTask();
            this.log?.appendLine(`Task ${taskId} aborted`);
        }
    }

    isBusy() {
        return this._isBusy;
    }

    isAsking() {
        return this._isAsking;
    }

    async waitForAddingTaskToStack(): Promise<void> {
        const stackSize = this.api.getCurrentTaskStack().length;
        while (this.api.getCurrentTaskStack().length === stackSize) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }

    private handleMessage(taskId: string, message: ClineMessage) {
        this.emit('keepalive');

        if (message.partial) {
            return;
        }

        if (message.type === 'ask') {
            this._isAsking = true;
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

            const userFeedback = message.type === 'say' && message.say === 'user_feedback';
            if (userFeedback) {
                this.emitRootTaskStarted(taskId);
            }

            postMessage(() => clineMessageToMessage(message));

            const finishesRootTask = message.type === 'say'
                && message.say === 'completion_result'
                && this.api.getCurrentTaskStack().length <= 1;

            if (finishesRootTask) {
                this.log?.appendLine("Finished root task!");
                postMessage({ type: 'status', status: 'completed' });
                this.emitRootTaskEnded(taskId);
            }
        }
    }

    private handleTaskCreated(taskId: string) {
        if (!this.rooCodeTasks.has(taskId)) {
            const createTask = this.createRooCodeTask ?? createUserTask;
            this.createRooCodeTask = undefined;

            const task = createTask(taskId);
            this.rooCodeTasks.set(taskId, task);
            this.emitRootTaskStarted(taskId);
            
        } // else: this task is a subtask
    }

    private handleTaskSpawned(taskId: string, childTaskId: string) {
        const rooCodeTask = this.rooCodeTasks.get(taskId);
        if (rooCodeTask !== undefined) {
            this.rooCodeTasks.set(childTaskId, rooCodeTask);
        }
    }

    private handleTaskAskResponded(taskId: string) {
        this._isAsking = false;
        this.emit('keepalive');
    }

    private handleTaskAborted(taskId: string) {
        const rooCodeTask = this.rooCodeTasks.get(taskId);
        if (rooCodeTask === undefined) {
            throw new Error("Aborting unknown task");
        }

        this.rooCodeTasks.delete(taskId);

        if (rooCodeTask.rootTaskId === taskId) {
            if (rooCodeTask.type === 'roospawn') {
                rooCodeTask.tx.send({ type: 'status', status: 'aborted' });
            }

            this.emitRootTaskEnded(taskId);
        }
    }

    private emitRootTaskStarted(taskId: string) {
        if (!this._isBusy) {
            this._isBusy = true;
            this.emit('rootTaskStarted', taskId);
        }
    }

    private emitRootTaskEnded(taskId: string) {
        if (this._isBusy) {
            this._isBusy = false;
            this.emit('rootTaskEnded', taskId);
        }
    }
}

type RooCodeTask =
    | { type: 'roospawn', rootTaskId: string, tx: MessagesTx }
    | { type: 'user', rootTaskId: string }
    ;


function userTasksFromApi(rooCode: RooCodeAPI): Map<string, RooCodeTask> {
    const tasksStack = rooCode.getCurrentTaskStack();

    if (tasksStack.length === 0) {
        return new Map();
    }

    const rootTaskId = tasksStack[0];
    const userTask: RooCodeTask = createUserTask(rootTaskId);
    return new Map(tasksStack.map(taskId => [taskId, userTask]));
}

function createUserTask(taskId: string): RooCodeTask {
    return { type: 'user', rootTaskId: taskId };
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
