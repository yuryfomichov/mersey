import type { ModelProvider, ModelRequest, ModelResponse } from '../models/index.js';

export type FakeProviderOptions = {
  model?: string;
  reply?: string | ((input: ModelRequest) => string);
};

export class FakeProvider implements ModelProvider {
  readonly model: string;
  readonly name: string = 'fake';
  readonly requests: ModelRequest[] = [];

  private readonly reply: string | ((input: ModelRequest) => string);

  constructor(options: FakeProviderOptions = {}) {
    this.model = options.model ?? 'fake-model';
    this.reply = options.reply ?? ((input) => `reply:${input.messages.at(-1)?.content ?? ''}`);
  }

  async generate(input: ModelRequest): Promise<ModelResponse> {
    this.requests.push(input);

    return {
      text: typeof this.reply === 'function' ? this.reply(input) : this.reply,
    };
  }
}
