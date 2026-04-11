import type { ModelRequest, ModelStreamEvent } from './types.js';

export interface ModelProvider {
  readonly model: string;
  readonly name: string;
  generate(input: ModelRequest): AsyncIterable<ModelStreamEvent>;
}
