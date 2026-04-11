import type { ModelProvider } from '../runtime/models/provider.js';
import { AnthropicProvider } from './anthropic.js';
import type { AnthropicConfig } from './anthropic.js';
import { FakeProvider } from './fake.js';
import type { FakeProviderOptions } from './fake.js';
import { MinimaxProvider } from './minimax.js';
import type { MinimaxConfig } from './minimax.js';
import { OpenAIProvider } from './openai.js';
import type { OpenAIConfig } from './openai.js';

export type ProviderName = 'anthropic' | 'fake' | 'minimax' | 'openai';

export type ProviderDefinition =
  | {
      config: AnthropicConfig;
      name: 'anthropic';
    }
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

function getUnsupportedProviderName(definition: ProviderDefinition): string {
  return String((definition as { name?: unknown }).name ?? 'unknown');
}

export function createProvider(definition: ProviderDefinition): ModelProvider {
  switch (definition.name) {
    case 'anthropic':
      return new AnthropicProvider(definition.config);
    case 'fake':
      return new FakeProvider(definition.config);
    case 'minimax':
      return new MinimaxProvider(definition.config);
    case 'openai':
      return new OpenAIProvider(definition.config);
    default:
      throw new Error(`Unsupported provider definition: ${getUnsupportedProviderName(definition)}`);
  }
}

export function parseProviderName(value: string): ProviderName {
  if (value === 'anthropic' || value === 'fake' || value === 'minimax' || value === 'openai') {
    return value;
  }

  throw new Error(`Unsupported provider: ${value}`);
}
