import type { HarnessEventListener } from './events/types.js';
import type { Harness } from './harness.js';

export type HarnessRuntimeDiagnostic = {
  code: string;
  message: string;
  severity: 'info' | 'warning' | 'error';
  sourceId?: string;
};

export type SourceStartupStatus = {
  message?: string;
  required: boolean;
  sourceId: string;
  status: 'ready' | 'degraded' | 'failed';
};

export type HarnessRuntimeStartup = {
  diagnostics: readonly HarnessRuntimeDiagnostic[];
  sources: readonly SourceStartupStatus[];
  status: 'ready' | 'degraded' | 'failed';
};

export type HarnessRuntime = {
  harness: Harness;
  startup: HarnessRuntimeStartup;
  dispose(): Promise<void>;
  subscribe(listener: HarnessEventListener): () => void;
};

export type CreateHarnessRuntimeResult =
  | {
      ok: true;
      runtime: HarnessRuntime;
    }
  | {
      ok: false;
      startup: HarnessRuntimeStartup;
    };
