export type HarnessRuntimeTrace = {
  detail: Record<string, unknown>;
  timestamp: string;
  type: string;
};

export interface HarnessLogger {
  log(event: HarnessRuntimeTrace): void | Promise<void>;
}
