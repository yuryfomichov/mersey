import { appendFile } from 'node:fs/promises';

import type { HarnessLogger, HarnessRuntimeTrace } from './types.js';

export type FileLoggerOptions = {
  path: string;
};

export function createQueuedFileLogger(
  options: FileLoggerOptions,
  formatEvent: (event: HarnessRuntimeTrace) => string,
): HarnessLogger {
  let pendingWrite = Promise.resolve();

  return {
    log(event: HarnessRuntimeTrace): Promise<void> {
      const line = formatEvent(event);
      const write = pendingWrite.then(() => appendFile(options.path, line, 'utf8'));

      pendingWrite = write.catch(() => {});

      return write;
    },
  };
}
