import type { ModelProvider } from '../models/provider.js';
import {
  createEmptyModelUsage,
  type ModelRequest,
  type ModelResponse,
  type ModelStreamEvent,
} from '../models/types.js';

type FakeProviderReply = string | ModelResponse | ((input: ModelRequest) => string | ModelResponse);
type FakeProviderStreamReply =
  | AsyncIterable<ModelStreamEvent>
  | ModelStreamEvent[]
  | ((input: ModelRequest) => AsyncIterable<ModelStreamEvent> | ModelStreamEvent[]);

export type FakeProviderOptions = {
  model?: string;
  reply?: FakeProviderReply;
  streamReply?: FakeProviderStreamReply;
};

async function* toAsyncIterable(
  events: AsyncIterable<ModelStreamEvent> | ModelStreamEvent[],
): AsyncIterable<ModelStreamEvent> {
  if (Symbol.asyncIterator in events) {
    yield* events;
    return;
  }

  yield* events;
}

export class FakeProvider implements ModelProvider {
  readonly model: string;
  readonly name: string = 'fake';
  readonly requests: ModelRequest[] = [];

  private readonly reply: FakeProviderReply;
  private readonly streamReply?: FakeProviderStreamReply;

  constructor(options: FakeProviderOptions = {}) {
    this.model = options.model ?? 'fake-model';
    this.reply = options.reply ?? ((input) => `reply:${input.messages.at(-1)?.content ?? ''}`);
    this.streamReply = options.streamReply;
  }

  private getResponse(input: ModelRequest): ModelResponse {
    const reply = typeof this.reply === 'function' ? this.reply(input) : this.reply;

    if (typeof reply === 'string') {
      return { text: reply, usage: createEmptyModelUsage() };
    }

    return { ...reply, usage: reply.usage ?? createEmptyModelUsage() };
  }

  private getStreamReply(input: ModelRequest): AsyncIterable<ModelStreamEvent> | ModelStreamEvent[] | undefined {
    if (!this.streamReply) {
      return undefined;
    }

    return typeof this.streamReply === 'function' ? this.streamReply(input) : this.streamReply;
  }

  async *generate(input: ModelRequest): AsyncIterable<ModelStreamEvent> {
    this.requests.push(input);

    if (input.stream) {
      const streamReply = this.getStreamReply(input);

      if (streamReply) {
        yield* toAsyncIterable(streamReply);
        return;
      }
    }

    const response = this.getResponse(input);

    yield {
      response,
      type: 'response_completed',
    };
  }
}
