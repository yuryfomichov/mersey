import type { HarnessLogger } from './types.js';

export { createJsonlFileLogger } from './jsonl.js';
export type { FileLoggerOptions } from './file.js';
export type { JsonlFileLoggerOptions } from './jsonl.js';
export { createTextFileLogger } from './text.js';
export type { TextFileLoggerOptions } from './text.js';
export type { HarnessLogger, HarnessRuntimeTrace } from './types.js';

export function emitRuntimeTrace(
  logger: HarnessLogger | undefined,
  type: string,
  detail: Record<string, unknown>,
): void {
  if (!logger) {
    return;
  }

  try {
    const result = logger.log({
      detail,
      timestamp: new Date().toISOString(),
      type,
    });

    if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
      void Promise.resolve(result).catch(() => {});
    }
  } catch {
    // Logging is best-effort and must never break a turn.
  }
}
