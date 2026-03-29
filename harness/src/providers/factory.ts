import type { ModelProvider } from '../models/index.js';
import { FakeProvider } from './fake.js';
import type { FakeProviderOptions } from './fake.js';
import { MinimaxProvider } from './minimax.js';
import type { MinimaxConfig } from './minimax.js';
import { OpenAIProvider } from './openai.js';
import type { OpenAIConfig } from './openai.js';

export type ProviderName = 'fake' | 'minimax' | 'openai';

export type ProviderDefinition =
  | {
      config?: FakeProviderOptions;
      name: 'fake';
    }
  | {
      config: MinimaxConfig;
      name: 'minimax';
    }
  | {
      config: OpenAIConfig;
      name: 'openai';
    };

export function createProvider(definition: ProviderDefinition): ModelProvider {
  switch (definition.name) {
    case 'fake':
      return new FakeProvider(definition.config);
    case 'minimax':
      return new MinimaxProvider(definition.config);
    case 'openai':
      return new OpenAIProvider(definition.config);
    default:
      throw new Error('Unsupported provider definition.');
  }
}

export function parseProviderName(value: string): ProviderName {
  if (value === 'fake' || value === 'minimax' || value === 'openai') {
    return value;
  }

  throw new Error(`Unsupported provider: ${value}`);
}
