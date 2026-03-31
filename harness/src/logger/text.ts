import { createQueuedFileLogger, type FileLoggerOptions } from './file.js';
import type { HarnessLogger, HarnessRuntimeTrace } from './types.js';

export type TextFileLoggerOptions = FileLoggerOptions;

function hasUnsafeStringContent(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);

    if (code <= 0x20 || code === 0x7f || character === '"' || character === '\\') {
      return true;
    }
  }

  return false;
}

function formatTraceValue(value: unknown): string {
  if (typeof value === 'string') {
    return hasUnsafeStringContent(value) ? JSON.stringify(value) : value;
  }

  if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
    return String(value);
  }

  return JSON.stringify(value);
}

function toTraceLine(event: HarnessRuntimeTrace): string {
  const detail = Object.entries(event.detail)
    .map(([key, value]) => `${key}=${formatTraceValue(value)}`)
    .join(' ');

  return detail ? `${event.timestamp} ${event.type} ${detail}` : `${event.timestamp} ${event.type}`;
}

export function createTextFileLogger(options: TextFileLoggerOptions): HarnessLogger {
  return createQueuedFileLogger(options, (event: HarnessRuntimeTrace) => `${toTraceLine(event)}\n`);
}
