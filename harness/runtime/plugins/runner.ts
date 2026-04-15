import type { HarnessEventReporter } from '../events/reporter.js';
import type { HarnessEvent } from '../events/types.js';
import type { ModelRequest } from '../models/types.js';
import type {
  BeforeProviderCallContext,
  BeforeToolCallContext,
  HookDecision,
  HarnessPlugin,
  PrepareProviderRequestContext,
  PrepareProviderRequestResult,
  PluginEventContext,
} from './types.js';

const SANITIZED_ERROR_REASON = 'Policy check failed';

export type PluginRunnerOptions = {
  reporter: HarnessEventReporter;
  plugins: HarnessPlugin[];
  runId: string;
};

export class PluginRunner {
  private readonly reporter: HarnessEventReporter;
  private readonly pluginsWithEvents: HarnessPlugin[];
  private readonly plugins: HarnessPlugin[];
  private readonly runId: string;

  constructor(options: PluginRunnerOptions) {
    this.reporter = options.reporter;
    this.plugins = options.plugins;
    this.pluginsWithEvents = this.plugins.filter((plugin) => Boolean(plugin.onEvent));
    this.runId = options.runId;

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

  async runPrepareProviderRequest(request: ModelRequest, ctx: PrepareProviderRequestContext): Promise<ModelRequest> {
    let nextRequest = request;

    for (const plugin of this.plugins) {
      if (!plugin.prepareProviderRequest) {
        continue;
      }

      try {
        const prepared = await plugin.prepareProviderRequest(nextRequest, ctx);

        nextRequest = applyPreparedRequest(nextRequest, prepared);
      } catch (error: unknown) {
        this.reporter.hookError(plugin.name, 'prepareProviderRequest', error);
        throw new Error(SANITIZED_ERROR_REASON);
      }
    }

    return nextRequest;
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
        this.reporter.hookError(plugin.name, 'beforeToolCall', error);
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
        void Promise.resolve(hookResult).catch((error: unknown) => {
          if (this.shouldEmitHookError(event)) {
            this.reporter.hookError(plugin.name, 'onEvent', error);
          }
        });
      }
    } catch (error: unknown) {
      if (this.shouldEmitHookError(event)) {
        this.reporter.hookError(plugin.name, 'onEvent', error);
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

function applyPreparedRequest(request: ModelRequest, prepared: PrepareProviderRequestResult): ModelRequest {
  const messages = [...(prepared.prependMessages ?? []), ...request.messages, ...(prepared.appendMessages ?? [])];
  const systemPrompt = Object.hasOwn(prepared, 'systemPrompt') ? prepared.systemPrompt : request.systemPrompt;

  return {
    ...request,
    messages,
    systemPrompt,
  };
}

export function createPluginRunner(options: PluginRunnerOptions): PluginRunner {
  return new PluginRunner(options);
}
