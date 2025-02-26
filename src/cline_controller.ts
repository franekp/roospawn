import { Channel, Waiters, Waiter } from './async_utils';
import { Cline, ClineAsk, ClineProvider, ClineSay } from './cline';
import { Task } from './task_dozer'; 

export type MessageType = { type: 'say', say: ClineSay } | { type: 'ask', ask: ClineAsk };

export interface Message {
    type: MessageType;
    text?: string;
    images?: string[];
}

export class ClineController {
    private channel?: Channel<Message, void>;
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

    async run(task: Task): Promise<AsyncGenerator<Message, void, void>> {
        let waiter = new Waiter(() =>
            !this.busy
            && !this.provider.cline?.isStreaming
            && !(this.provider.cline?.clineMessages[-1]?.type === 'ask' && !this.provider.cline?.abort)
        );
        this.waiters.add(waiter);
        await waiter.wait();
        this.busy = true;

        const { tx, rx } = Channel.create<Message, void>();

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

        if (this.task !== undefined && this.channel !== undefined) {
            let channel = this.channel;
            this.channel = undefined;

            const oldSay = cline.say.bind(cline);
            const oldAsk = cline.ask.bind(cline);
            const oldAbortTask = cline.abortTask.bind(cline);

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

                        channel.ret();
                        this.setNotBusy();
                    }
                }
            };

            cline.ask = async (type, text, partial) => {
                if (partial === false || partial === undefined) {
                    channel.send({ type: { type: 'ask', ask: type }, text });
                }

                return await oldAsk(type, text, partial);
            };

            cline.abortTask = async (isAbandoned: boolean = false) => {
                await oldAbortTask(isAbandoned);

                this.task = undefined;
                cline.say = oldSay;
                cline.ask = oldAsk;
                cline.abortTask = oldAbortTask;

                channel.ret();
                this.setNotBusy();
            };
        } else {
            const oldSay = cline.say.bind(cline);
            const oldAsk = cline.ask.bind(cline);
            const oldAbortTask = cline.abortTask.bind(cline);

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
