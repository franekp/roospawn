export class Channel<T, Tr = void> {
    private resolvers: ((data: Data<T, Tr>) => void)[] = [];
    private data: Data<T, Tr>[] = [];
    private returned: boolean = false;

    private constructor() {}

    static create<T, Tr = void>(): { tx: Channel<T, Tr>, rx: AsyncGenerator<T, Tr, void> } {
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

export class Waiters {
    private waiters: Waiter[] = [];

    add(waiter: Waiter) {
        this.waiters.push(waiter);
    }

    wake() {
        for (let i = 0; i < this.waiters.length;) {
            if (this.waiters[i].wake()) {
                return;
            } else {
                this.waiters.splice(i, 1);
            }
        }
    }
}

export class Waiter {
    private waker?: () => void;
    private completed: boolean = false;

    constructor(private condition: () => boolean) {}

    async wait() {
        while (!this.condition()) {
            await timeout(1000, new Promise<void>((resolve) => this.waker = resolve));
            this.waker = undefined;
        }

        this.completed = true;
    }

    wake(): boolean {
        if (this.completed) {
            return false;
        }

        this.waker?.();
        this.waker = undefined;
        return true;
    }
}

export function timeout<T>(ms: number | 'no_timeout', promise?: Promise<T>): Promise<{ reason: 'timeout' } | { reason: 'promise', value: T }> {
    if (ms === 'no_timeout') {
        if (promise === undefined) {
            return Promise.resolve({ reason: 'promise', value: undefined as T });
        }
        return promise.then(value => ({ reason: 'promise', value }));
    }
    const t = new Promise<{ reason: 'timeout' }>((resolve) => setTimeout(() => resolve({ reason: 'timeout' }), ms));
    if (promise === undefined) {
        return t;
    }
    const p: Promise<{ reason: 'promise', value: T }> = promise.then(value => ({ reason: 'promise', value }));
    return Promise.race([t, p]);
}
