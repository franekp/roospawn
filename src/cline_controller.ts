import { ClineAPI, ClineAsk, ClineProvider, ClineSay } from './cline';

export type MessageType = { type: 'say', say: ClineSay } | { type: 'ask', ask: ClineAsk };

export interface Message {
    type: MessageType;
    text?: string;
    images?: string[];
}

export class ClineController {
    private channel?: Channel<Message, void>;
    private task?: Task;

    constructor(private provider: ClineProvider) {
        const controller = this;

        const oldInitClineWithTask = provider.initClineWithTask.bind(provider);
        provider.initClineWithTask = async (task, images) => {
            console.log('initClineWithTask', task, images);
            await oldInitClineWithTask(task, images);

            // Only tamper in Cline instances that handle our tasks
            if (controller.task !== undefined && controller.channel !== undefined) {
                // Obtain the channel TX
                let channel = controller.channel;
                controller.channel = undefined;

                let cline = provider.cline!;
                const oldSay = cline.say.bind(cline);
                const oldAsk = cline.ask.bind(cline);

                cline.say = async (type, text, images, partial, checkpoint) => {
                    if (partial === false || partial === undefined) {
                        const message: Message = { type: { type: 'say', say: type }, text, images };
                        channel.send(message);

                        if (type === 'completion_result') {
                            this.task = undefined;
                            cline.say = oldSay;
                            cline.ask = oldAsk;

                            channel.ret();
                        }
                    }
                    await oldSay(type, text, images, partial, checkpoint);
                };

                cline.ask = async (type, text, partial) => {
                    if (partial === false || partial === undefined) {
                        channel.send({ type: { type: 'ask', ask: type }, text });
                    }
                    const response = await oldAsk(type, text, partial);
                    // TODO: do we want to handle the response too?
                    return response;
                };
            }
            
        };
    }

    run(task: Task): AsyncGenerator<Message, void, void> {
        if (this.task !== undefined) {
            throw new Error('ClineController: already running a task');
        }
        const { tx, rx } = Channel.create<Message, void>();

        this.channel = tx;
        this.task = task;

        this.provider.initClineWithTask(task.prompt);
        return rx;
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

import { Task } from './task_dozer'; 