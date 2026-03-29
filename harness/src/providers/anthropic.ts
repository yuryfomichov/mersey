import Anthropic from '@anthropic-ai/sdk';

import type { ModelProvider, ModelRequest, ModelResponse } from '../models/index.js';

export type AnthropicProviderConfig = {
  apiKey: string;
  baseUrl: string;
  model: string;
  maxTokens: number;
};

function getResponseText(response: Anthropic.Message): string {
  const text = response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text.trim())
    .filter(Boolean)
    .join('\n\n');

  return text || 'Model returned no text response.';
}

export class AnthropicBaseProvider implements ModelProvider {
  protected readonly client: Anthropic;
  readonly maxTokens: number;
  readonly model: string;
  readonly name: string = 'anthropic-compatible';

  constructor(config: AnthropicProviderConfig) {
    this.client = new Anthropic({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
    });
    this.maxTokens = config.maxTokens;
    this.model = config.model;
  }

  async generate(input: ModelRequest): Promise<ModelResponse> {
    const response = await this.client.messages.create({
      max_tokens: this.maxTokens,
      messages: input.messages,
      model: this.model,
    });

    return {
      text: getResponseText(response),
    };
  }
}
