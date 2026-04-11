import Anthropic from '@anthropic-ai/sdk';
import type { MessageParam, Tool } from '@anthropic-ai/sdk/resources/messages/messages';

import type { ModelProvider } from '../runtime/models/provider.js';
import type { ModelRequest, ModelStreamEvent } from '../runtime/models/types.js';
import { AnthropicCodec } from './codecs/anthropic.js';

export type AnthropicLikeProviderConfig = {
  apiKey: string;
  baseUrl: string;
  model: string;
  maxTokens: number;
  cache?: boolean;
};

export type AnthropicConfig = AnthropicLikeProviderConfig;

export abstract class AnthropicLikeProvider implements ModelProvider {
  protected readonly codec: AnthropicCodec;
  protected readonly client: Anthropic;
  readonly maxTokens: number;
  readonly model: string;
  readonly name: string = 'anthropic-compatible';
  readonly cache: boolean;

  constructor(config: AnthropicLikeProviderConfig, codec: AnthropicCodec) {
    this.client = new Anthropic({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
    });
    this.maxTokens = config.maxTokens;
    this.model = config.model;
    this.codec = codec;
    this.cache = config.cache ?? false;
  }

  private getRequest(input: ModelRequest): {
    max_tokens: number;
    messages: MessageParam[];
    model: string;
    system: ModelRequest['systemPrompt'];
    tools: Tool[] | undefined;
    cache_control?: { type: 'ephemeral' };
  } {
    return {
      max_tokens: this.maxTokens,
      messages: this.codec.getMessages(input),
      model: this.model,
      system: input.systemPrompt,
      tools: this.codec.getTools(input),
      ...(this.cache && { cache_control: { type: 'ephemeral' } }),
    };
  }

  async *generate(input: ModelRequest): AsyncIterable<ModelStreamEvent> {
    if (!input.stream) {
      const response = await this.client.messages.create(this.getRequest(input), { signal: input.signal });

      yield {
        response: {
          text: this.codec.getResponseText(response),
          toolCalls: this.codec.getToolCalls(response),
          usage: this.codec.getUsage(response),
        },
        type: 'response_completed',
      };

      return;
    }

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
        usage: this.codec.getUsage(response),
      },
      type: 'response_completed',
    };
  }
}

export class AnthropicProvider extends AnthropicLikeProvider {
  constructor(config: AnthropicConfig) {
    super(config, new AnthropicCodec());
  }

  readonly name = 'anthropic';
}
