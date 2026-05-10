import type { HarnessEventReporter } from '../events/reporter.js';
import type { ModelToolCall } from '../models/types.js';
import type { HarnessRuntimeDiagnostic, SourceStartupStatus } from '../runtime.js';
import {
  buildStartupStatus,
  normalizeSourceDiagnostics,
  RuntimeSourceError,
  type RuntimeSourceRegistration,
} from '../sources.js';
import type {
  ResolvedToolCall,
  ToolCatalog,
  ToolCatalogSnapshot,
  ToolDescriptor,
  ToolExecutionContext,
} from './catalog.js';

type SnapshotResult = {
  degradedSourceIds: string[];
  snapshot: ToolCatalogSnapshot;
};

function validateDescriptors(descriptors: readonly ToolDescriptor[]): void {
  const publicNames = new Map<string, string>();
  const toolIds = new Map<string, string>();

  for (const descriptor of descriptors) {
    const existingNameSource = publicNames.get(descriptor.identity.publicName);

    if (existingNameSource) {
      throw new Error(
        `Duplicate tool publicName \`${descriptor.identity.publicName}\` across ${existingNameSource} and ${descriptor.identity.sourceId}.`,
      );
    }

    const existingIdSource = toolIds.get(descriptor.identity.toolId);

    if (existingIdSource) {
      throw new Error(
        `Duplicate toolId \`${descriptor.identity.toolId}\` across ${existingIdSource} and ${descriptor.identity.sourceId}.`,
      );
    }

    publicNames.set(descriptor.identity.publicName, descriptor.identity.sourceId);
    toolIds.set(descriptor.identity.toolId, descriptor.identity.sourceId);
  }
}

function composeSnapshots(snapshots: readonly ToolCatalogSnapshot[]): ToolCatalogSnapshot {
  const descriptors = Object.freeze(snapshots.flatMap((snapshot) => snapshot.descriptors));

  validateDescriptors(descriptors);

  return Object.freeze({
    descriptors,
    async execute(call: ResolvedToolCall, ctx: ToolExecutionContext) {
      const snapshot = snapshots.find((candidate) =>
        candidate.descriptors.some((descriptor) => descriptor.identity.toolId === call.toolId),
      );

      if (!snapshot) {
        throw new Error(`Resolved tool is not available in the current snapshot: ${call.toolId}`);
      }

      return snapshot.execute(call, ctx);
    },
    resolve(call: ModelToolCall) {
      for (const snapshot of snapshots) {
        const resolved = snapshot.resolve(call);

        if (resolved) {
          return resolved;
        }
      }

      return null;
    },
  });
}

export class ComposedToolCatalog {
  private readonly registrations: readonly RuntimeSourceRegistration<ToolCatalog>[];

  constructor(registrations: readonly RuntimeSourceRegistration<ToolCatalog>[]) {
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
    const startupDescriptors: ToolDescriptor[] = [];

    for (const registration of this.registrations) {
      const sourceDiagnostics: HarnessRuntimeDiagnostic[] = [];

      try {
        const startup = await registration.startup?.();

        if (startup?.diagnostics?.length) {
          sourceDiagnostics.push(...normalizeSourceDiagnostics(registration.sourceId, startup.diagnostics));
          diagnostics.push(...sourceDiagnostics);
        }

        const snapshot = await registration.value.snapshot({ iteration: 0, sessionId: 'startup', turnId: 'startup' });
        validateDescriptors(snapshot.descriptors);
        startupDescriptors.push(...snapshot.descriptors);

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
        const severity = registration.required ? 'error' : 'warning';
        const diagnostic = {
          code: 'tool_catalog_startup_failed',
          message,
          severity,
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

    try {
      validateDescriptors(startupDescriptors);
    } catch (error: unknown) {
      diagnostics.push({
        code: 'tool_catalog_collision',
        message: error instanceof Error ? error.message : String(error),
        severity: 'error',
      });
    }

    return { diagnostics, sources };
  }

  async snapshot(ctx: {
    iteration: number;
    reporter: HarnessEventReporter;
    sessionId: string;
    turnId: string;
  }): Promise<SnapshotResult> {
    const snapshots: ToolCatalogSnapshot[] = [];
    const degradedSourceIds: string[] = [];

    for (const registration of this.registrations) {
      try {
        snapshots.push(
          await registration.value.snapshot({
            iteration: ctx.iteration,
            sessionId: ctx.sessionId,
            turnId: ctx.turnId,
          }),
        );
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
        ctx.reporter.turnSnapshotDegraded(
          ctx.iteration,
          [registration.sourceId],
          error instanceof Error ? error.message : String(error),
        );
      }
    }

    return {
      degradedSourceIds,
      snapshot: composeSnapshots(snapshots),
    };
  }
}
