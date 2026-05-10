import type { HarnessEventReporter } from '../events/reporter.js';
import type { HarnessEvent } from '../events/types.js';
import { RuntimeWorkTracker } from '../lifecycle.js';
import type {
  BeforeProviderCallContext,
  BeforeToolExecutionContext,
  HarnessPlugin,
  HookDecision,
  PluginEventContext,
} from './types.js';

const SANITIZED_ERROR_REASON = 'Policy check failed';

export type PluginRunnerOptions = {
  plugins: HarnessPlugin[];
  reporter: HarnessEventReporter;
  runId: string;
  workTracker: RuntimeWorkTracker;
};

export class PluginRunner {
  private readonly pluginsWithEvents: HarnessPlugin[];
  private readonly plugins: HarnessPlugin[];
  private readonly reporter: HarnessEventReporter;
  private readonly runId: string;
  private readonly workTracker: RuntimeWorkTracker;

  constructor(options: PluginRunnerOptions) {
    this.plugins = options.plugins;
    this.pluginsWithEvents = this.plugins.filter((plugin) => Boolean(plugin.onEvent));
    this.reporter = options.reporter;
    this.runId = options.runId;
    this.workTracker = options.workTracker;

    if (this.pluginsWithEvents.length > 0) {
      this.reporter.subscribe((event) => {
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
        this.reporter.hookError(plugin.name, 'beforeProviderCall', error);
        return {
          continue: false,
          reason: SANITIZED_ERROR_REASON,
        };
      }
    }

    return { continue: true };
  }

  async runBeforeToolExecution(ctx: BeforeToolExecutionContext): Promise<HookDecision> {
    for (const plugin of this.plugins) {
      if (!plugin.beforeToolExecution) {
        continue;
      }

      try {
        const decision = await plugin.beforeToolExecution(ctx);

        if (decision.continue === false) {
          return decision;
        }
      } catch (error: unknown) {
        this.reporter.hookError(plugin.name, 'beforeToolExecution', error);
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
        sessionId: event.sessionId,
        ...(event.type === 'session_started' ? {} : { turnId: event.turnId }),
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
        void this.workTracker.track(
          Promise.resolve(hookResult).catch((error: unknown) => {
            if (event.type !== 'hook_error') {
              this.reporter.hookError(plugin.name, 'onEvent', error, {
                sessionId: pluginCtx.sessionId,
                turnId: pluginCtx.turnId,
              });
            }
          }),
        );
      }
    } catch (error: unknown) {
      if (event.type !== 'hook_error') {
        this.reporter.hookError(plugin.name, 'onEvent', error, {
          sessionId: pluginCtx.sessionId,
          turnId: pluginCtx.turnId,
        });
      }
    }
  }
}

export function createPluginRunner(options: PluginRunnerOptions): PluginRunner {
  return new PluginRunner(options);
}
