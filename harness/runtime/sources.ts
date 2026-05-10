import type { HarnessRuntimeDiagnostic, SourceStartupStatus } from './runtime.js';

export type RuntimeSourceRegistration<T> = {
  dispose?(): Promise<void> | void;
  required?: boolean;
  sourceId: string;
  startup?(): Promise<{
    diagnostics?: HarnessRuntimeDiagnostic[];
    message?: string;
    status?: 'ready' | 'degraded' | 'failed';
  }>;
  value: T;
};

export class RuntimeSourceError extends Error {
  readonly sourceIds: readonly string[];

  constructor(message: string, sourceIds: readonly string[], cause?: unknown) {
    super(message);
    this.name = 'RuntimeSourceError';
    this.sourceIds = Object.freeze([...sourceIds]);

    if (cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = cause;
    }
  }
}

export function getRuntimeSourceErrorSourceIds(error: unknown): string[] {
  return error instanceof RuntimeSourceError ? [...error.sourceIds] : [];
}

export function normalizeSourceDiagnostics(
  sourceId: string,
  diagnostics: readonly HarnessRuntimeDiagnostic[],
): HarnessRuntimeDiagnostic[] {
  return diagnostics.map((diagnostic) => (diagnostic.sourceId ? diagnostic : { ...diagnostic, sourceId }));
}

export function buildStartupStatus(options: {
  diagnostics: HarnessRuntimeDiagnostic[];
  message?: string;
  required: boolean;
  sourceId: string;
  status?: 'ready' | 'degraded' | 'failed';
}): SourceStartupStatus {
  const inferredStatus =
    options.status ??
    (options.diagnostics.some((diagnostic) => diagnostic.severity === 'error')
      ? 'failed'
      : options.diagnostics.some((diagnostic) => diagnostic.severity === 'warning')
        ? 'degraded'
        : 'ready');

  const status = !options.required && inferredStatus === 'failed' ? 'degraded' : inferredStatus;

  return {
    message: options.message,
    required: options.required,
    sourceId: options.sourceId,
    status,
  };
}
