import { AnthropicBaseProvider, type AnthropicProviderConfig } from './anthropic.js';
import { getRequiredEnv } from './env.js';

export type MinimaxEnvironment = {
  MINIMAX_API_KEY?: string;
  MINIMAX_BASE_URL?: string;
  MINIMAX_MODEL?: string;
  MINIMAX_MAX_TOKENS?: string;
};

export type MinimaxConfig = AnthropicProviderConfig;

export function getMinimaxConfig(env: MinimaxEnvironment = process.env): MinimaxConfig {
  const maxTokens = Number.parseInt(getRequiredEnv(env, 'MINIMAX_MAX_TOKENS', 'minimax'), 10);

  if (!Number.isInteger(maxTokens) || maxTokens <= 0) {
    throw new Error('MINIMAX_MAX_TOKENS must be a positive integer.');
  }

  return {
    apiKey: getRequiredEnv(env, 'MINIMAX_API_KEY', 'minimax'),
    baseUrl: getRequiredEnv(env, 'MINIMAX_BASE_URL', 'minimax'),
    model: getRequiredEnv(env, 'MINIMAX_MODEL', 'minimax'),
    maxTokens,
  };
}

export class MinimaxProvider extends AnthropicBaseProvider {
  readonly name = 'minimax';

  static fromEnv(env: MinimaxEnvironment = process.env): MinimaxProvider {
    return new MinimaxProvider(getMinimaxConfig(env));
  }
}
