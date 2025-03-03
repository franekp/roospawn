import { Channel, Waiters, Waiter, timeout } from './async_utils';
import { Cline, ClineAsk, ClineProvider, ClineSay } from './cline';
import { Task } from './roo_spawn'; 

export type MessageType = { type: 'say', say: ClineSay } | { type: 'ask', ask: ClineAsk };
export type ExitReason = 'completed' | 'aborted' | 'hanging' | 'thrown-exception';

export interface Message {
    type: MessageType;
    text?: string;
    images?: string[];
}

export class ClineController {
    private channel?: Channel<Message, ExitReason>;
    private task?: Task;

    private busy: boolean = false;
    private waiters: Waiters = new Waiters();

    constructor(private provider: ClineProvider) {
        const controller = this;

        if (provider.cline !== undefined) {
            this.attachTrackingToCline(provider.cline);
        }

        const oldInitClineWithTask = provider.initClineWithTask.bind(provider);
        provider.initClineWithTask = async (task, images) => {
            console.log('initClineWithTask', task, images);
            await oldInitClineWithTask(task, images);
            controller.attachTrackingToCline(provider.cline!);
        };
    }

    async run(getTask: () => Task | undefined): Promise<AsyncGenerator<Message, ExitReason, void> | undefined> {
        let waiter = new Waiter(() =>
            !this.busy
            && !this.provider.cline?.isStreaming
            && !(this.provider.cline?.clineMessages[-1]?.type === 'ask' && !this.provider.cline?.abort)
        );
        this.waiters.add(waiter);
        await waiter.wait();
        this.busy = true;

        const task = getTask();

        if (task === undefined) {
            this.setNotBusy();
            return Promise.resolve(undefined);
        }

        const { tx, rx } = Channel.create<Message, ExitReason>();

        this.channel = tx;
        this.task = task;

        this.provider.initClineWithTask(task.prompt);
        return rx;
    }

    private setNotBusy() {
        this.busy = false;
        this.waiters.wake();
    }

    private attachTrackingToCline(cline: Cline) {
        this.busy = true;

        const oldSay: Cline['say'] = cline.say.bind(cline);
        const oldAsk: Cline['ask'] = cline.ask.bind(cline);
        const oldAbortTask: Cline['abortTask'] = cline.abortTask.bind(cline);

        if (this.task !== undefined && this.channel !== undefined) {
            let channel = this.channel;
            this.channel = undefined;

            cline.say = async (type, text, images, partial, checkpoint) => {
                await oldSay(type, text, images, partial, checkpoint);

                if (partial === false || partial === undefined) {
                    const message: Message = { type: { type: 'say', say: type }, text, images };
                    channel.send(message);

                    if (type === 'completion_result') {
                        this.task = undefined;
                        cline.say = oldSay;
                        cline.ask = oldAsk;
                        cline.abortTask = oldAbortTask;

                        channel.ret('completed');
                        this.setNotBusy();
                    }
                }
            };

            cline.ask = async (type, text, partial) => {
                if (partial === false || partial === undefined) {
                    channel.send({ type: { type: 'ask', ask: type }, text });
                }

                const result = await timeout(10000, oldAsk(type, text, partial));
                switch (result.reason) {
                    case 'timeout':
                        this.task = undefined;
                        cline.say = oldSay;
                        cline.ask = oldAsk;
                        cline.abortTask = oldAbortTask;

                        channel.ret('hanging');
                        oldAbortTask(true);
                        this.setNotBusy();
                        // TODO: Or throwing an error is a better idea?
                        return { response: 'noButtonClicked' };
                    case 'promise':
                        return result.value;
                }
            };

            cline.abortTask = async (isAbandoned: boolean = false) => {
                await oldAbortTask(isAbandoned);

                this.task = undefined;
                cline.say = oldSay;
                cline.ask = oldAsk;
                cline.abortTask = oldAbortTask;

                channel.ret('aborted');
                this.setNotBusy();
            };
        } else {
            cline.say = async (type, text, images, partial, checkpoint) => {
                await oldSay(type, text, images, partial, checkpoint);

                if (partial === false || partial === undefined) {
                    if (type === 'completion_result') {
                        cline.say = oldSay;
                        cline.ask = oldAsk;
                        cline.abortTask = oldAbortTask;
                        this.setNotBusy();
                    }
                }
            };

            cline.ask = async (type, text, partial) => {
                this.busy = true;
                return await oldAsk(type, text, partial);
            };

            cline.abortTask = async (isAbandoned: boolean = false) => {
                await oldAbortTask(isAbandoned);

                cline.say = oldSay;
                cline.ask = oldAsk;
                cline.abortTask = oldAbortTask;
                this.setNotBusy();
            };
        }
    }
}
