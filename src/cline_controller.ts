import { Channel, Waiters, Waiter, timeout } from './async_utils';
import { Cline, ClineAsk, ClineProvider, ClineSay, HistoryItem } from './cline';
import { Task } from './roospawn';


export type Message =
    | { type: 'say', say: ClineSay, text?: string, images?: string[] }
    | { type: 'ask', ask: ClineAsk, text?: string }
    | { type: 'status', status: Status }
    | { type: 'exitMessageHandler' }
    ;

export type Status = 'completed' | 'aborted' | 'asking' | 'error';

export type MessagesTx = Channel<Message>;
export type MessagesRx = AsyncGenerator<Message, void, void>;

export interface ControllingTrackerParams {
    channel: MessagesTx;
    timeout: number;
    clineId?: string;
}

export class ClineController {
    /// We set this flag to `true` when we know that some task is running within controlled `ClineProvider`.
    private busy: boolean = false;
    private waiters: Waiters = new Waiters();

    constructor(private provider: ClineProvider, private tasks: Task[]) {
        const controller = this;

        // If the provider already has a `Cline` instance, attach state tracking to the instance.
        // The instance can be conducting only non-Roo-Spawn task, because `ClineController` is
        // created before starting the first Roo-Spawn task.
        if (provider.cline !== undefined) {
            this.attachObservingTrackerToCline(provider.cline);
        }

        // Override the `initClineWithTask` and `initClineWithHistoryItem` methods to attach state tracking
        // to all new `Cline` instances. Each task is conducted within a separate `Cline` instance.
        // The patched version of `initClineWithTask` gets additional `channel` parameter,
        // which is set only for Roo-Spawn tasks. This way we know which tasks are generated by Roo-Spawn,
        // and where to send related messages.

        // TODO: should we patch `initClineWithSubtask`?

        const oldInitClineWithTask = provider.initClineWithTask.bind(provider);
        const oldInitClineWithHistoryItem = provider.initClineWithHistoryItem.bind(provider);

        provider.initClineWithTask = async (task?: string, images?: string[], params?: ControllingTrackerParams) => {
            this.busy = true;

            await oldInitClineWithTask(task, images);

            if (params !== undefined) {
                controller.attachControllingTrackerToCline(provider.cline!, params);
            } else {
                controller.attachObservingTrackerToCline(provider.cline!);
            }
        };

        provider.initClineWithHistoryItem = async (historyItem: HistoryItem) => {
            this.busy = true;
            const clineId = historyItem.id;

            await oldInitClineWithHistoryItem(historyItem);

            const task = this.tasks.find(task => task.clineId === clineId);
            if (task?.tx !== undefined) {
                let params: ControllingTrackerParams = {
                    channel: task.tx,
                    timeout: 300*1000,
                };
                controller.attachControllingTrackerToCline(provider.cline!, params);
                task.clineId = params.clineId;
            } else {
                controller.attachObservingTrackerToCline(provider.cline!);
            }
        };
    }

    async run(getTask: () => Task | undefined): Promise<{ channel?: MessagesRx, task: Task } | undefined> {
        // We can run a Roo-Spawn task only if there is no other task running in the `ClineProvider`.
        // The waiter's condition is best effort to check whether some task is running in the provider.
        let waiter = new Waiter(() =>
            !this.busy
            && !this.provider.cline?.isStreaming
            && !(this.provider.cline?.clineMessages[-1]?.type === 'ask' && !this.provider.cline?.abort)
        );
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
        const historyItem = clineId !== undefined
            ? (await this.provider.getTaskWithId(clineId)).historyItem
            : undefined;

        if (historyItem === undefined) {
            const { tx, rx } = Channel.create<Message>();

            const params: ControllingTrackerParams = {
                channel: tx,
                timeout: 10000,
            };

            await this.provider.initClineWithTask(task.prompt, undefined, params);
            task.clineId = params.clineId;
            task.tx = tx;

            return { channel: rx, task };
        } else {
            await this.provider.initClineWithHistoryItem(historyItem);
            return { task };
        }
    }

    attachControllingTrackerToCline(cline: Cline, params: ControllingTrackerParams) {
        // We can set busy to false only once.
        let canSetBusy = true;
        const setBusy = (busy: boolean) => {
            if (canSetBusy) {
                canSetBusy = busy;
                this.busy = busy;
                if (busy === false) {
                    this.waiters.wake();
                }
            }
        };

        params.clineId = cline.taskId;

        const oldSay: Cline['say'] = cline.say.bind(cline);
        const oldAsk: Cline['ask'] = cline.ask.bind(cline);
        const oldAbortTask: Cline['abortTask'] = cline.abortTask.bind(cline);

        const { channel, timeout: timeoutMs } = params;

        cline.say = async (type, text, images, partial, checkpoint) => {
            await oldSay(type, text, images, partial, checkpoint);

            if (partial === false || partial === undefined) {
                const message: Message = { type: 'say', say: type, text, images };
                channel.send(message);

                if (type === 'completion_result') {
                    cline.say = oldSay;
                    cline.ask = oldAsk;
                    cline.abortTask = oldAbortTask;

                    channel.send({ type: 'status', status: 'completed' });
                    setBusy(false);
                }
            }
        };

        cline.ask = async (type, text, partial) => {
            if (partial === false || partial === undefined) {
                channel.send({ type: 'ask', ask: type, text });
            }

            const askPromise = oldAsk(type, text, partial);
            const result = await timeout(timeoutMs, askPromise);
            if (result.reason === 'timeout') {
                cline.say = oldSay;
                cline.ask = oldAsk;
                cline.abortTask = oldAbortTask;

                channel.send({ type: 'status', status: 'asking' });
                // Allow other tasks to run.
                // Running another task will call `ClineProvider.initClineWithTask`,
                // which internally aborts the current task.
                setBusy(false);
            }

            return await askPromise;
        };

        cline.abortTask = async (isAbandoned: boolean = false) => {
            cline.say = oldSay;
            cline.ask = oldAsk;
            cline.abortTask = oldAbortTask;

            await oldAbortTask(isAbandoned);

            channel.send({ type: 'status', status: 'aborted' });
            setBusy(false);
        };
    }

    attachObservingTrackerToCline(cline: Cline) {
        // We can set busy to false only once.
        let canSetBusy = true;
        const setBusy = (busy: boolean) => {
            if (canSetBusy) {
                canSetBusy = busy;
                this.busy = busy;
                if (busy === false) {
                    this.waiters.wake();
                }
            }
        };

        const oldSay: Cline['say'] = cline.say.bind(cline);
        const oldAsk: Cline['ask'] = cline.ask.bind(cline);
        const oldAbortTask: Cline['abortTask'] = cline.abortTask.bind(cline);

        cline.say = async (type, text, images, partial, checkpoint) => {
            await oldSay(type, text, images, partial, checkpoint);

            if (partial === false || partial === undefined) {
                if (type === 'completion_result') {
                    cline.say = oldSay;
                    cline.ask = oldAsk;
                    cline.abortTask = oldAbortTask;
                    setBusy(false);
                }
            }
        };

        cline.ask = async (type, text, partial) => {
            setBusy(true);
            return await oldAsk(type, text, partial);
        };

        cline.abortTask = async (isAbandoned: boolean = false) => {
            cline.say = oldSay;
            cline.ask = oldAsk;
            cline.abortTask = oldAbortTask;

            await oldAbortTask(isAbandoned);

            setBusy(false);
        };
    }
}

