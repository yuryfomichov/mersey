import { AnthropicLikeProvider, type AnthropicLikeProviderConfig } from './anthropic.js';

export type MinimaxConfig = AnthropicLikeProviderConfig;

export class MinimaxProvider extends AnthropicLikeProvider {
  readonly name = 'minimax';
}
