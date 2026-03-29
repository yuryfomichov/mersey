import type { ModelProvider } from '../models/index.js';
import { FakeProvider } from './fake.js';
import { MinimaxProvider } from './minimax.js';

export type ProviderName = 'fake' | 'minimax';

export function createProvider(name: ProviderName): ModelProvider {
  switch (name) {
    case 'fake':
      return new FakeProvider();
    case 'minimax':
      return MinimaxProvider.fromEnv();
    default:
      throw new Error(`Unsupported provider: ${name}`);
  }
}

export function parseProviderName(value: string): ProviderName {
  if (value === 'fake' || value === 'minimax') {
    return value;
  }

  throw new Error(`Unsupported provider: ${value}`);
}
