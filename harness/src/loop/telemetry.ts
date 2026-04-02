import { createHash } from 'node:crypto';
import { basename, isAbsolute } from 'node:path';

import type { DebugToolArgs, SafeCommandArgSummary, SafePathArgSummary, SafeToolArgs } from '../events/types.js';

export type TelemetryOptions = {
  debug?: boolean;
};

function getOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function getValueDigest(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 12);
}

function summarizeCommandArg(value: unknown): SafeCommandArgSummary | undefined {
  const command = getOptionalString(value);

  if (!command) {
    return undefined;
  }

  return {
    digest: getValueDigest(command),
    length: command.length,
    present: true,
  };
}

function summarizePathArg(value: unknown): SafePathArgSummary | undefined {
  const pathValue = getOptionalString(value);

  if (!pathValue) {
    return undefined;
  }

  return {
    basename: basename(pathValue),
    digest: getValueDigest(pathValue),
    length: pathValue.length,
    looksAbsolute: isAbsolute(pathValue),
    present: true,
  };
}

function summarizeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    return undefined;
  }

  return value;
}

export function getSafeToolArgs(input: unknown): SafeToolArgs {
  if (!isRecord(input)) {
    return {};
  }

  const command = summarizeCommandArg(input.command);
  const cwd = summarizePathArg(input.cwd);
  const path = summarizePathArg(input.path);

  return {
    ...(command ? { command } : {}),
    ...(cwd ? { cwd } : {}),
    ...(path ? { path } : {}),
  };
}

export function getDebugToolArgs(input: unknown, options: TelemetryOptions = {}): DebugToolArgs | undefined {
  if (!options.debug || !isRecord(input)) {
    return undefined;
  }

  const command = getOptionalString(input.command);
  const cwd = getOptionalString(input.cwd);
  const path = getOptionalString(input.path);
  const args = summarizeStringArray(input.args);

  const debugArgs = {
    ...(args ? { args } : {}),
    ...(command ? { command } : {}),
    ...(cwd ? { cwd } : {}),
    ...(path ? { path } : {}),
  };

  return Object.keys(debugArgs).length > 0 ? debugArgs : undefined;
}

export function getResultDataKeys(data: Record<string, unknown> | undefined): string[] {
  return data ? Object.keys(data).sort() : [];
}

export function sanitizeErrorMessage(errorType: 'provider' | 'tool' | 'runtime', error: unknown): string {
  if (
    errorType === 'runtime' &&
    error instanceof Error &&
    /^Tool loop exceeded \d+ iterations\.$/.test(error.message)
  ) {
    return error.message;
  }

  if (errorType === 'provider') {
    return 'Provider request failed.';
  }

  if (errorType === 'tool') {
    return 'Tool execution failed.';
  }

  return 'Runtime failed.';
}
