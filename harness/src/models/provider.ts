import type { ModelRequest, ModelResponse, ModelStreamEvent } from './types.js';

export interface ModelProvider {
  readonly model: string;
  readonly name: string;
  generate(input: ModelRequest): Promise<ModelResponse>;
}

export interface StreamingModelProvider extends ModelProvider {
  stream(input: ModelRequest): AsyncIterable<ModelStreamEvent>;
}

export function supportsStreaming(provider: ModelProvider): provider is StreamingModelProvider {
  return typeof (provider as Partial<StreamingModelProvider>).stream === 'function';
}
