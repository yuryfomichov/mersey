import type { HarnessLogger, HarnessRuntimeTraceType } from './types.js';

export function emitRuntimeTrace(
  logger: HarnessLogger | undefined,
  type: HarnessRuntimeTraceType,
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
