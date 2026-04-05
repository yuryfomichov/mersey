import type { HarnessObserver } from '../events/observer.js';
import type {
  BeforeProviderCallContext,
  BeforeToolCallContext,
  HookDecision,
  HarnessPlugin,
  PluginEventContext,
} from './types.js';

const SANITIZED_ERROR_REASON = 'Policy check failed';

export type PluginRunnerOptions = {
  observer: HarnessObserver;
  plugins: HarnessPlugin[];
  runId: string;
};

export class PluginRunner {
  private readonly plugins: HarnessPlugin[];
  private readonly runId: string;

  constructor(options: PluginRunnerOptions) {
    this.plugins = options.plugins;
    this.runId = options.runId;

    for (const plugin of this.plugins) {
      if (plugin.onEvent) {
        const pluginCtx: PluginEventContext = {
          pluginName: plugin.name,
          runId: this.runId,
        };
        const observer = options.observer;
        observer.subscribe((event) => {
          if (plugin.onEvent) {
            void plugin.onEvent(event, pluginCtx);
          }
        });
      }
    }
  }

  async runBeforeProviderCall(ctx: BeforeProviderCallContext): Promise<HookDecision> {
    for (const plugin of this.plugins) {
      if (!plugin.beforeProviderCall) {
        continue;
      }

      try {
        const decision = await plugin.beforeProviderCall(ctx);

        if (decision.continue === false) {
          return decision;
        }
      } catch {
        return {
          continue: false,
          reason: SANITIZED_ERROR_REASON,
        };
      }
    }

    return { continue: true };
  }

  async runBeforeToolCall(ctx: BeforeToolCallContext): Promise<HookDecision> {
    for (const plugin of this.plugins) {
      if (!plugin.beforeToolCall) {
        continue;
      }

      try {
        const decision = await plugin.beforeToolCall(ctx);

        if (decision.continue === false) {
          return decision;
        }
      } catch {
        return {
          continue: false,
          reason: SANITIZED_ERROR_REASON,
        };
      }
    }

    return { continue: true };
  }
}

export function createPluginRunner(options: PluginRunnerOptions): PluginRunner {
  return new PluginRunner(options);
}
