import { Anthropic } from '@anthropic-ai/sdk';
import { Channel } from '../../async_utils';


export interface ModelInfo {
	maxTokens?: number
	contextWindow: number
	supportsImages?: boolean
	supportsComputerUse?: boolean
	supportsPromptCache: boolean // this value is hardcoded for now
	inputPrice?: number
	outputPrice?: number
	cacheWritesPrice?: number
	cacheReadsPrice?: number
	description?: string
	reasoningEffort?: "low" | "medium" | "high"
	thinking?: boolean
}

export type ApiStream = AsyncGenerator<ApiStreamChunk>
export type ApiStreamChunk = ApiStreamTextChunk | ApiStreamUsageChunk | ApiStreamReasoningChunk

export interface ApiStreamTextChunk {
	type: "text"
	text: string
}

export interface ApiStreamReasoningChunk {
	type: "reasoning"
	text: string
}

export interface ApiStreamUsageChunk {
	type: "usage"
	inputTokens: number
	outputTokens: number
	cacheWriteTokens?: number
	cacheReadTokens?: number
	totalCost?: number // openrouter
}


export class FakeAi {
	readonly handlersManager = new HandlersManager();
    
	constructor(private readonly onUnhandledQuery: () => void) {}

    async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]) {
        const handlerRx = this.handlersManager.handle(systemPrompt, messages);
        if (handlerRx) {
			for await (const chunk of handlerRx) {
				console.log("chunk", chunk);
				yield chunk;
			}
        } else {
			this.onUnhandledQuery();
		}
    }

    getModel(): { id: string; info: ModelInfo } {
        return { id: 'fake-ai', info: { contextWindow: 10000, supportsPromptCache: false }};
    }
    async countTokens(content: Array<Anthropic.Messages.ContentBlockParam>): Promise<number> {
        return 0;
    }
}

export class HandlersManager {
	private handlers: Handler[] = [];

	handle(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): AsyncGenerator<any> | undefined {
		for (const [index, matcher] of this.handlers.entries()) {
			if (matcher.matcher(systemPrompt, messages, this)) {
				this.handlers.splice(index, 1);
				return matcher.rx;
			}
		}
		return undefined;
	}

	add(name?: string, handler?: HandlerFn): Channel<any> {
		const { tx, rx } = Channel.create<any>();
		this.handlers.push(new Handler(name, handler ?? (() => true), rx, tx));
		return tx;
	}

	remove(name: string) {
		const newHandlers = [];
		for (const handler of this.handlers) {
			if (handler.name === name) {
				handler.tx.ret();
			} else {
				newHandlers.push(handler);
			}
		}
		this.handlers = newHandlers;
	}

	get length() {
		return this.handlers.length;
	}
}

export type HandlerFn = (systemPrompt: string, messages: Anthropic.Messages.MessageParam[], manager: HandlersManager) => boolean;

class Handler {
	constructor(
		readonly name: string | undefined,
		readonly matcher: HandlerFn,
		readonly rx: AsyncGenerator<any>,
		readonly tx: Channel<any>,
	) {}
}