import type { HarnessObserver } from '../events/observer.js';
import type { HarnessEvent } from '../events/types.js';
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
  private readonly observer: HarnessObserver;
  private readonly pluginsWithEvents: HarnessPlugin[];
  private readonly plugins: HarnessPlugin[];
  private readonly runId: string;

  constructor(options: PluginRunnerOptions) {
    this.observer = options.observer;
    this.plugins = options.plugins;
    this.pluginsWithEvents = this.plugins.filter((plugin) => Boolean(plugin.onEvent));
    this.runId = options.runId;

    if (this.pluginsWithEvents.length > 0) {
      this.observer.subscribe((event) => {
        this.deliverEvent(event);
      });
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
      } catch (error: unknown) {
        this.observer.hookError(plugin.name, 'beforeProviderCall', error);
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
      } catch (error: unknown) {
        this.observer.hookError(plugin.name, 'beforeToolCall', error);
        return {
          continue: false,
          reason: SANITIZED_ERROR_REASON,
        };
      }
    }

    return { continue: true };
  }

  private deliverEvent(event: HarnessEvent): void {
    for (const plugin of this.pluginsWithEvents) {
      const pluginCtx: PluginEventContext = {
        pluginName: plugin.name,
        runId: this.runId,
      };

      this.runEventHook(plugin, pluginCtx, event);
    }
  }

  private runEventHook(plugin: HarnessPlugin, pluginCtx: PluginEventContext, event: HarnessEvent): void {
    if (!plugin.onEvent) {
      return;
    }

    try {
      const hookResult = plugin.onEvent(event, pluginCtx);

      if (hookResult && typeof (hookResult as PromiseLike<unknown>).then === 'function') {
        void Promise.resolve(hookResult).catch((error: unknown) => {
          if (this.shouldEmitHookError(event)) {
            this.observer.hookError(plugin.name, 'onEvent', error);
          }
        });
      }
    } catch (error: unknown) {
      if (this.shouldEmitHookError(event)) {
        this.observer.hookError(plugin.name, 'onEvent', error);
      }
    }
  }

  private shouldEmitHookError(event: HarnessEvent): boolean {
    if (event.type === 'hook_error') {
      return false;
    }

    return true;
  }
}

export function createPluginRunner(options: PluginRunnerOptions): PluginRunner {
  return new PluginRunner(options);
}
