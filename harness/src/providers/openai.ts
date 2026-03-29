import OpenAI from 'openai';

import type { ModelProvider, ModelRequest, ModelResponse } from '../models/index.js';

export type OpenAILikeProviderConfig = {
  apiKey: string;
  baseUrl: string;
  model: string;
  maxTokens: number;
};

export type OpenAIConfig = OpenAILikeProviderConfig;

export class OpenAILikeProvider implements ModelProvider {
  protected readonly client: OpenAI;
  readonly maxTokens: number;
  readonly model: string;
  readonly name: string = 'openai-compatible';

  constructor(config: OpenAILikeProviderConfig) {
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
    });
    this.maxTokens = config.maxTokens;
    this.model = config.model;
  }

  async generate(input: ModelRequest): Promise<ModelResponse> {
    const response = await this.client.responses.create({
      input: input.messages.map((message) => ({
        content: message.content,
        role: message.role,
      })),
      max_output_tokens: this.maxTokens,
      model: this.model,
    });

    return {
      text: response.output_text.trim() || 'Model returned no text response.',
    };
  }
}

export class OpenAIProvider extends OpenAILikeProvider {
  readonly name = 'openai';
}
