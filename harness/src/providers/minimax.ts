import { AnthropicLikeProvider, type AnthropicLikeProviderConfig } from './anthropic.js';
import { AnthropicCodec } from './codecs/anthropic.js';

export type MinimaxConfig = AnthropicLikeProviderConfig;

export class MinimaxProvider extends AnthropicLikeProvider {
  constructor(config: MinimaxConfig) {
    super(config, new AnthropicCodec());
  }

  readonly name = 'minimax';
}
