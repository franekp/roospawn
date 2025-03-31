import { IClineController, Message, MessagesRx } from "../../cline_controller";

export class EventsCollector {
    readonly events: Event[] = [];
    private resolvers: ((event: Event) => void)[] = [];
    private readonly exitMessagesRxs: (() => void)[] = [];

    private readonly onRootTaskStarted: (taskId: string) => void;
    private readonly onRootTaskEnded: (taskId: string) => void;

    constructor(private readonly controller: IClineController) {
        this.onRootTaskStarted = (taskId) => {
            this.emitEvent({ type: 'rootTaskStarted', taskId });
        };
        this.onRootTaskEnded = (taskId) => {
            this.emitEvent({ type: 'rootTaskEnded', taskId });
        };

        this.controller.on('rootTaskStarted', this.onRootTaskStarted);
        this.controller.on('rootTaskEnded', this.onRootTaskEnded);
    }

    dispose() {
        this.controller.off('rootTaskStarted', this.onRootTaskStarted);
        this.controller.off('rootTaskEnded', this.onRootTaskEnded);
        for (const exit of this.exitMessagesRxs) {
            exit();
        }
    }

    async addMessagesRx(messagesRx: MessagesRx, sender: string, exit: () => void) {
        this.exitMessagesRxs.push(exit);
        for await (const message of messagesRx) {
            this.emitEvent({ type: 'message', sender, message });

            if (message.type === 'exitMessageHandler') {
                return;
            }
        }
    }

    async waitForEvent(): Promise<void> {
        await new Promise<Event>((resolve) => {
            this.resolvers.push(resolve);
        });
    }

    private emitEvent(event: Event) {
        this.events.push(event);
        for (const resolver of this.resolvers) {
            resolver(event);
        }
        this.resolvers = [];
    }
}

interface EventResolver {
    resolve: (event: Event) => void;
    filter: (event: Event) => boolean;
}

export type Event =
    | { type: 'message', sender: string, message: Message }
    | { type: 'rootTaskStarted', taskId: string }
    | { type: 'rootTaskEnded', taskId: string }
    ;

export class Cursor {
    constructor(private readonly eventsCollector: EventsCollector, private index: number = -1) {}

    clone(): Cursor {
        return new Cursor(this.eventsCollector, this.index);
    }

    async next(): Promise<Event> {
        while (this.index + 1 >= this.eventsCollector.events.length) {
            await this.eventsCollector.waitForEvent();
        }
        this.index += 1;
        return this.eventsCollector.events[this.index];
    }

    async waitFor(filter: (event: Event) => boolean): Promise<Event> {
        while (true) {
            const event = await this.next();
            if (filter(event)) {
                return event;
            }
        }
    }
}
