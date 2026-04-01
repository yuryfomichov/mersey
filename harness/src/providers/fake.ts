import type { ModelRequest, ModelResponse, ModelStreamEvent, StreamingModelProvider } from '../models/index.js';

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

export class FakeProvider implements StreamingModelProvider {
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

    return typeof reply === 'string' ? { text: reply } : reply;
  }

  async generate(input: ModelRequest): Promise<ModelResponse> {
    this.requests.push(input);

    return this.getResponse(input);
  }

  async *stream(input: ModelRequest): AsyncIterable<ModelStreamEvent> {
    this.requests.push(input);

    if (this.streamReply) {
      const streamReply = typeof this.streamReply === 'function' ? this.streamReply(input) : this.streamReply;

      yield* toAsyncIterable(streamReply);
      return;
    }

    const response = this.getResponse(input);

    if (response.text) {
      yield {
        delta: response.text,
        type: 'text_delta',
      };
    }

    yield {
      response,
      type: 'response_completed',
    };
  }
}
