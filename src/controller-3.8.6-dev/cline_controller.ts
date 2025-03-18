import * as vscode from 'vscode';
import { Waiters, Waiter, Channel } from '../async_utils';
import { ClineAsk, ClineMessage, ClineSay, RooCodeAPI } from './roo-code';
import { Task } from '../roospawn';
import { IClineController, Message, MessagesTx, MessagesRx, UserTaskSwitch } from '../cline_controller';


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
export class ClineController implements IClineController {
    // TODO: add a map of "taskId" -> ControllingTrackerParams
    
    /// We set this flag to `true` when we know that some task is running within controlled `ClineProvider`.
    private busy: boolean = false;
    private waiters: Waiters = new Waiters();
    private log: vscode.OutputChannel | undefined;

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
        this.api.on('taskStarted', (taskId) => this.handleTaskStarted(taskId));
        this.api.on('taskSpawned', (taskId, childTaskId) => this.handleTaskSpawned(taskId, childTaskId));
        this.api.on('taskAskResponded', (taskId) => this.handleTaskAskResponded(taskId));
        this.api.on('taskAborted', (taskId) => this.handleTaskAborted(taskId));

        if (enableLogging) {
            this.setUpLogger();
        }
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

    async waitUntilNotBusy(): Promise<void> { await new Promise(resolve => {}); }  // never resolves
    async canResumeTask(task: Task): Promise<boolean> { throw new Error('Not implemented'); }
    async resumeTask(task: Task): Promise<void> { throw new Error('Not implemented'); }
    async startTask(task: Task): Promise<MessagesRx> { throw new Error('Not implemented'); }

    async run(
        getTask: () => Task | undefined,
        beforeStart: (task: Task, isResuming: boolean) => Promise<{failed: boolean}>,
    ): Promise<{ channel?: MessagesRx, task: Task } | undefined> {
        for (const i of [1]) {
            throw new Error('Not implemented');
        }

        // We can run a Roo-Spawn task only if there is no other task running in the `ClineProvider`.
        // The waiter's condition is best effort to check whether some task is running in the provider.
        let waiter = new Waiter(() => {
            if (this.busy) {
                return false;
            }

            const tasks = this.api.getCurrentTaskStack();
            if (tasks.length === 0) {
                return true;
            }

            const lastTask = tasks[tasks.length - 1];
            const lastTaskMessages = this.api.getMessages(lastTask);

            // TODO: read the messages and check if some of them is `task_completed
            return true;
        });
        this.waiters.add(waiter);
        await waiter.wait();

        this.busy = true;

        const task = getTask();

        // If `task` is undefined, it means that there was some task for which we were waiting to run,
        // but the run-task-request was cancelled by the user in the meantime.
        if (task === undefined) {
            this.busy = false;
            this.waiters.wake();
            return Promise.resolve(undefined);
        }

        const clineId = task.clineId;
        const isResuming = clineId !== undefined ? await this.api.isTaskInHistory(clineId) : false;
        if ((await beforeStart(task, isResuming)).failed) {
            return Promise.resolve(undefined);
        }
        
        if (isResuming) {
            try {
                await this.api.resumeTask(clineId!);
                return { task };
            } catch {
                // If failed, fall back to the "new task" path.
            }
        }

        const { tx, rx } = Channel.create<Message>();

        const params: ControllingTrackerParams = {
            channel: tx,
            timeout: 10000,
        };

        task.clineId = await this.api.startNewTask(task.prompt, undefined);
        task.tx = tx;
        
        return { channel: rx, task };   
    }

    handleMessage(taskId: string, message: ClineMessage) {
        // TODO: handle messages
    }

    handleTaskStarted(taskId: string) {
        // TODO: if some 3rd party task was started, we should set "busy" flag
    }

    handleTaskSpawned(taskId: string, childTaskId: string) {
        // TODO: the child task should also be observed by this controller
        //       and preempted if user do not respond to the task "ask requests" in time
    }

    handleTaskAskResponded(taskId: string) {
        // TODO: clear related timeout
    }

    handleTaskAborted(taskId: string) {
        // TODO: send message to the channel
    }
}
