import type { HarnessRuntimeStartup } from '../../../harness/types.js';

function formatDiagnosticLine(diagnostic: HarnessRuntimeStartup['diagnostics'][number]): string {
  return `${diagnostic.severity}: ${diagnostic.sourceId ? `${diagnostic.sourceId}: ` : ''}${diagnostic.message}`;
}

function formatSourceLine(source: HarnessRuntimeStartup['sources'][number]): string {
  return `${source.status}: ${source.sourceId}${source.required ? ' [required]' : ''}${source.message ? `: ${source.message}` : ''}`;
}

export function getStartupStatusLines(startup: HarnessRuntimeStartup): string[] {
  if (startup.status === 'ready') {
    return [];
  }

  const lines =
    startup.diagnostics.length > 0
      ? startup.diagnostics.map(formatDiagnosticLine)
      : startup.sources.filter((source) => source.status !== 'ready').map(formatSourceLine);

  return [`startup: ${startup.status}`, ...lines];
}
