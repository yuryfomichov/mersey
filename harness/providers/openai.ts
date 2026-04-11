import OpenAI from 'openai';

import type { ModelProvider } from '../runtime/models/provider.js';
import type { ModelRequest, ModelStreamEvent } from '../runtime/models/types.js';
import { OpenAICodec } from './codecs/openai.js';

export type OpenAILikeProviderConfig = {
  apiKey: string;
  baseUrl: string;
  model: string;
  maxTokens: number;
  cache?: boolean;
};

export type OpenAIConfig = OpenAILikeProviderConfig;

export abstract class OpenAILikeProvider implements ModelProvider {
  protected readonly codec: OpenAICodec;
  protected readonly client: OpenAI;
  readonly maxTokens: number;
  readonly model: string;
  readonly name: string = 'openai-compatible';
  readonly cache: boolean;

  constructor(config: OpenAILikeProviderConfig, codec: OpenAICodec) {
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
    });
    this.maxTokens = config.maxTokens;
    this.model = config.model;
    this.codec = codec;
    this.cache = config.cache ?? false;
  }

  private getRequest(input: ModelRequest) {
    const request = {
      input: this.codec.getInputItems(input),
      instructions: input.systemPrompt,
      max_output_tokens: this.maxTokens,
      model: this.model,
      tools: this.codec.getTools(input),
    };

    if (this.cache) {
      // TODO: Some OpenAI models reject 24h prompt cache retention; handle unsupported models without failing requests.
      return { ...request, prompt_cache_retention: '24h' as const };
    }

    return request;
  }

  async *generate(input: ModelRequest): AsyncIterable<ModelStreamEvent> {
    if (!input.stream) {
      const response = await this.client.responses.create(this.getRequest(input), { signal: input.signal });

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

    const stream = this.client.responses.stream(this.getRequest(input), { signal: input.signal });

    for await (const event of stream) {
      if (event.type === 'response.output_text.delta') {
        yield {
          delta: event.delta,
          type: 'text_delta',
        };
      }
    }

    const response = await stream.finalResponse();

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

export class OpenAIProvider extends OpenAILikeProvider {
  constructor(config: OpenAIConfig) {
    super(config, new OpenAICodec());
  }

  readonly name = 'openai';
}
