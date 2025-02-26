import { ClineAPI, ClineAsk, ClineProvider, ClineSay } from './cline';
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
    private waiting: (() => void)[] = [];

    constructor(private provider: ClineProvider) {
        const controller = this;

        const oldInitClineWithTask = provider.initClineWithTask.bind(provider);
        provider.initClineWithTask = async (task, images) => {
            console.log('initClineWithTask', task, images);
            await oldInitClineWithTask(task, images);

            controller.busy = true;

            if (controller.task !== undefined && controller.channel !== undefined) {
                // Obtain the channel TX
                let channel = controller.channel;
                controller.channel = undefined;

                let cline = provider.cline!;
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
                            controller.setNotBusy();
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
                    controller.setNotBusy();
                };
            } else {
                let cline = provider.cline!;
                const oldSay = cline.say.bind(cline);
                const oldAbortTask = cline.abortTask.bind(cline);

                cline.say = async (type, text, images, partial, checkpoint) => {
                    await oldSay(type, text, images, partial, checkpoint);

                    if (partial === false || partial === undefined) {
                        if (type === 'completion_result') {
                            cline.say = oldSay;
                            cline.abortTask = oldAbortTask;
                            controller.setNotBusy();
                        }
                    }
                };

                cline.abortTask = async (isAbandoned: boolean = false) => {
                    await oldAbortTask(isAbandoned);

                    cline.say = oldSay;
                    cline.abortTask = oldAbortTask;
                    controller.setNotBusy();
                };
            }
            
        };
    }

    async run(task: Task): Promise<AsyncGenerator<Message, void, void>> {
        while (this.busy) {
            await new Promise<void>((resolve) => this.waiting.push(resolve));
        }
        this.busy = true;

        const { tx, rx } = Channel.create<Message, void>();

        this.channel = tx;
        this.task = task;

        this.provider.initClineWithTask(task.prompt);
        return rx;
    }

    private setNotBusy() {
        this.busy = false;
        this.waiting.shift()?.();
    }
}

class Channel<T, Tr> {
    private resolvers: ((data: Data<T, Tr>) => void)[] = [];
    private data: Data<T, Tr>[] = [];
    private returned: boolean = false;

    private constructor() {}

    static create<T, Tr>(): { tx: Channel<T, Tr>, rx: AsyncGenerator<T, Tr, void> } {
        const channel = new Channel<T, Tr>();
        const rx = async function* () {
            while (true) {
                const data = await channel.receive();
                switch (data.type) {
                    case 'send':
                        yield data.value;
                        break;
                    case 'ret':
                        return data.value;
                }
            }
        }();
        return { tx: channel, rx };
    }

    send(value: T) {
        if (this.returned) {
            throw new Error('Channel: cannot send after ret');
        }

        const data: Data<T, Tr> = { type: 'send', value };
        const resolver = this.resolvers.shift();
        if (resolver !== undefined) {
            resolver(data);
        } else {
            this.data.push(data);
        }
    }

    ret(value: Tr) {
        if (this.returned) {
            throw new Error('Channel: cannot ret after ret');
        }
        this.returned = true;

        const data: Data<T, Tr> = { type: 'ret', value };
        const resolver = this.resolvers.shift();
        if (resolver !== undefined) {
            resolver(data);
        } else {
            this.data.push(data);
        }
    }

    private receive(): Promise<Data<T, Tr>> {
        const data = this.data.shift();
        if (data !== undefined) {
            return Promise.resolve(data);
        }

        if (this.returned) {
            throw new Error('Channel: cannot receive after ret');
        }

        return new Promise((resolve) => {
            this.resolvers.push(resolve);
        });
    }
}

type Data<T, Tr> = { type: 'send', value: T } | { type: 'ret', value: Tr };
