import type { ModelRequest, ModelResponse } from './types.js';

export interface ModelProvider {
  readonly model: string;
  readonly name: string;
  generate(input: ModelRequest): Promise<ModelResponse>;
}
