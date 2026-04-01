import { createQueuedFileLogger, type FileLoggerOptions } from './file.js';
import type { HarnessLogger, HarnessRuntimeTrace } from './types.js';
import { toTraceLine } from './utils.js';

export type TextFileLoggerOptions = FileLoggerOptions;

export function createTextFileLogger(options: TextFileLoggerOptions): HarnessLogger {
  return createQueuedFileLogger(options, (event: HarnessRuntimeTrace) => `${toTraceLine(event)}\n`);
}
