import Anthropic from '@anthropic-ai/sdk';
import type { MessageParam, Tool } from '@anthropic-ai/sdk/resources/messages/messages';

import type { StreamingModelProvider } from '../models/provider.js';
import type { ModelRequest, ModelResponse, ModelStreamEvent } from '../models/types.js';
import { AnthropicCodec } from './codecs/anthropic.js';

export type AnthropicLikeProviderConfig = {
  apiKey: string;
  baseUrl: string;
  model: string;
  maxTokens: number;
};

export class AnthropicLikeProvider implements StreamingModelProvider {
  private readonly codec = new AnthropicCodec();
  protected readonly client: Anthropic;
  readonly maxTokens: number;
  readonly model: string;
  readonly name: string = 'anthropic-compatible';

  constructor(config: AnthropicLikeProviderConfig) {
    this.client = new Anthropic({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
    });
    this.maxTokens = config.maxTokens;
    this.model = config.model;
  }

  private getRequest(input: ModelRequest): {
    max_tokens: number;
    messages: MessageParam[];
    model: string;
    system: ModelRequest['systemPrompt'];
    tools: Tool[] | undefined;
  } {
    return {
      max_tokens: this.maxTokens,
      messages: this.codec.getMessages(input),
      model: this.model,
      system: input.systemPrompt,
      tools: this.codec.getTools(input),
    };
  }

  async generate(input: ModelRequest): Promise<ModelResponse> {
    const response = await this.client.messages.create(this.getRequest(input), { signal: input.signal });
    const toolCalls = this.codec.getToolCalls(response);
    const text = this.codec.getResponseText(response);

    return {
      text,
      toolCalls,
    };
  }

  async *stream(input: ModelRequest): AsyncIterable<ModelStreamEvent> {
    const stream = this.client.messages.stream(this.getRequest(input), { signal: input.signal });

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        yield {
          delta: event.delta.text,
          type: 'text_delta',
        };
      }
    }

    const response = await stream.finalMessage();

    yield {
      response: {
        text: this.codec.getResponseText(response),
        toolCalls: this.codec.getToolCalls(response),
      },
      type: 'response_completed',
    };
  }
}
