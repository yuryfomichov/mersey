import type { HarnessEventReporter } from '../events/reporter.js';
import type { TurnContextCollectContext, TurnContextCollector } from '../plugins/types.js';
import type { HarnessRuntimeDiagnostic, SourceStartupStatus } from '../runtime.js';
import type { RuntimeSourceRegistration } from '../sources.js';
import { buildStartupStatus, normalizeSourceDiagnostics, RuntimeSourceError } from '../sources.js';
import { normalizeTurnContext, indexCollectorContributions } from './pipeline.js';
import type { NormalizedTurnContext } from './types.js';

const EMPTY_CONTEXT: NormalizedTurnContext = Object.freeze({
  messages: Object.freeze([]),
  metadata: Object.freeze({}),
  resources: Object.freeze([]),
});

export class TurnContextCollectorRunner {
  private readonly registrations: readonly RuntimeSourceRegistration<TurnContextCollector>[];

  constructor(registrations: readonly RuntimeSourceRegistration<TurnContextCollector>[]) {
    this.registrations = registrations;
  }

  async dispose(): Promise<void> {
    for (const registration of [...this.registrations].reverse()) {
      await registration.dispose?.();
    }
  }

  async runStartupValidation(): Promise<{ diagnostics: HarnessRuntimeDiagnostic[]; sources: SourceStartupStatus[] }> {
    const diagnostics: HarnessRuntimeDiagnostic[] = [];
    const sources: SourceStartupStatus[] = [];

    for (const registration of this.registrations) {
      try {
        const startup = await registration.startup?.();
        const sourceDiagnostics = normalizeSourceDiagnostics(registration.sourceId, startup?.diagnostics ?? []);
        diagnostics.push(...sourceDiagnostics);
        sources.push(
          buildStartupStatus({
            diagnostics: sourceDiagnostics,
            message: startup?.message,
            required: registration.required ?? false,
            sourceId: registration.sourceId,
            status: startup?.status,
          }),
        );
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        const diagnostic = {
          code: 'turn_context_collector_startup_failed',
          message,
          severity: registration.required ? 'error' : 'warning',
          sourceId: registration.sourceId,
        } satisfies HarnessRuntimeDiagnostic;
        diagnostics.push(diagnostic);
        sources.push(
          buildStartupStatus({
            diagnostics: [diagnostic],
            message,
            required: registration.required ?? false,
            sourceId: registration.sourceId,
            status: registration.required ? 'failed' : 'degraded',
          }),
        );
      }
    }

    return { diagnostics, sources };
  }

  async collect(
    ctx: TurnContextCollectContext,
    reporter: HarnessEventReporter,
  ): Promise<{ context: NormalizedTurnContext; degradedSourceIds: string[] }> {
    if (this.registrations.length === 0) {
      return { context: EMPTY_CONTEXT, degradedSourceIds: [] };
    }

    const batches: Array<{
      contributions: Awaited<ReturnType<TurnContextCollector['collect']>>;
      registrationOrder: number;
    }> = [];
    const degradedSourceIds: string[] = [];

    for (const [registrationOrder, registration] of this.registrations.entries()) {
      try {
        const contributions = await registration.value.collect(ctx);
        batches.push({ contributions, registrationOrder });
      } catch (error: unknown) {
        if (registration.required) {
          throw error instanceof RuntimeSourceError
            ? error
            : new RuntimeSourceError(
                error instanceof Error ? error.message : String(error),
                [registration.sourceId],
                error,
              );
        }

        degradedSourceIds.push(registration.sourceId);
        reporter.turnSnapshotDegraded(
          ctx.iteration,
          [registration.sourceId],
          error instanceof Error ? error.message : String(error),
        );
      }
    }

    return {
      context: normalizeTurnContext(indexCollectorContributions(batches)),
      degradedSourceIds,
    };
  }
}
