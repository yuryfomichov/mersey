import type { ModelProvider, ModelRequest, ModelResponse } from '../models/index.js';

type FakeProviderReply = string | ModelResponse | ((input: ModelRequest) => string | ModelResponse);

export type FakeProviderOptions = {
  model?: string;
  reply?: FakeProviderReply;
};

export class FakeProvider implements ModelProvider {
  readonly model: string;
  readonly name: string = 'fake';
  readonly requests: ModelRequest[] = [];

  private readonly reply: FakeProviderReply;

  constructor(options: FakeProviderOptions = {}) {
    this.model = options.model ?? 'fake-model';
    this.reply = options.reply ?? ((input) => `reply:${input.messages.at(-1)?.content ?? ''}`);
  }

  async generate(input: ModelRequest): Promise<ModelResponse> {
    this.requests.push(input);
    const reply = typeof this.reply === 'function' ? this.reply(input) : this.reply;

    return typeof reply === 'string' ? { text: reply } : reply;
  }
}
