import { Waiters, Waiter, Channel } from '../async_utils';
import { ClineAsk, ClineMessage, ClineSay, RooCodeAPI } from './roo-code';
import { Task } from '../roospawn';
import { IClineController, Message, MessagesTx, MessagesRx } from '../cline_controller';


export interface ControllingTrackerParams {
    channel: MessagesTx;
    timeout: number;
    clineId?: string;
}

export class ClineController implements IClineController {
    // TODO: add a map of "taskId" -> ControllingTrackerParams
    
    /// We set this flag to `true` when we know that some task is running within controlled `ClineProvider`.
    private busy: boolean = false;
    private waiters: Waiters = new Waiters();

    constructor(private api: RooCodeAPI, private tasks: Task[]) {
        // attach events to the API
        this.api.on('message', ({ taskId, message }) => this.handleMessage(taskId, message));
        this.api.on('taskStarted', ({ taskId }) => this.handleTaskStarted(taskId));
        this.api.on('taskSpawned', ({ taskId, childTaskId }) => this.handleTaskSpawned(taskId, childTaskId));
        this.api.on('taskAskResponded', ({ taskId }) => this.handleTaskAskResponded(taskId));
        this.api.on('taskAborted', ({ taskId }) => this.handleTaskAborted(taskId));
    }

    async run(
        getTask: () => Task | undefined,
        beforeStart: (task: Task, isResuming: boolean) => Promise<{failed: boolean}>,
    ): Promise<{ channel?: MessagesRx, task: Task } | undefined> {
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
        const isResuming = await this.api.isTaskInHistory(clineId);
        if ((await beforeStart(task, isResuming)).failed) {
            return Promise.resolve(undefined);
        }
        
        if (isResuming) {
            try {
                await this.api.resumeTask(clineId);
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
