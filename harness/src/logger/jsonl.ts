import { createQueuedFileLogger, type FileLoggerOptions } from './file.js';
import type { HarnessLogger, HarnessRuntimeTrace } from './types.js';

export type JsonlFileLoggerOptions = FileLoggerOptions;

export function createJsonlFileLogger(options: JsonlFileLoggerOptions): HarnessLogger {
  return createQueuedFileLogger(options, (event: HarnessRuntimeTrace) => `${JSON.stringify(event)}\n`);
}
