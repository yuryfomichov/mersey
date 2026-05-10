import type { HarnessEventReporter } from '../events/reporter.js';
import { RuntimeWorkTracker } from '../lifecycle.js';
import type { TurnCommitContext, TurnCommitObserver } from '../plugins/types.js';
import type { HarnessRuntimeDiagnostic, SourceStartupStatus } from '../runtime.js';
import type { RuntimeSourceRegistration } from '../sources.js';
import { buildStartupStatus, normalizeSourceDiagnostics } from '../sources.js';

export class TurnCommitObserverRunner {
  private readonly registrations: readonly RuntimeSourceRegistration<TurnCommitObserver>[];
  private readonly reporter: HarnessEventReporter;
  private readonly workTracker: RuntimeWorkTracker;

  constructor(options: {
    registrations: readonly RuntimeSourceRegistration<TurnCommitObserver>[];
    reporter: HarnessEventReporter;
    workTracker: RuntimeWorkTracker;
  }) {
    this.registrations = options.registrations;
    this.reporter = options.reporter;
    this.workTracker = options.workTracker;
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
          code: 'turn_commit_observer_startup_failed',
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

  runAfterCommit(ctx: TurnCommitContext): void {
    if (this.registrations.length === 0) {
      return;
    }

    void this.workTracker.track(
      (async () => {
        for (const registration of this.registrations) {
          try {
            await registration.value.afterTurnCommitted(ctx);
          } catch (error: unknown) {
            this.reporter.hookError(registration.sourceId, 'afterTurnCommitted', error, {
              sessionId: ctx.sessionId,
              turnId: ctx.turnId,
            });
          }
        }
      })(),
    );
  }
}
