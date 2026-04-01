import type { HarnessLogger } from './types.js';

export function createFanoutLogger(loggers: HarnessLogger[] | undefined): HarnessLogger | undefined {
  if (!loggers?.length) {
    return undefined;
  }

  return {
    log(event): void {
      for (const logger of loggers) {
        try {
          const result = logger.log(event);

          if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
            void Promise.resolve(result).catch(() => {});
          }
        } catch {
          // Logger failures are best-effort and isolated.
        }
      }
    },
  };
}
