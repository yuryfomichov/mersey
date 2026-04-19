import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import { createJsonlMemoryPlugin } from '../../../harness/plugins/index.js';
import type { HarnessPlugin } from '../../../harness/types.js';
import { getArgValue, getBooleanFlag } from './args.js';

const DEFAULT_MAX_CONTEXT_CHARS = 2_000;
const DEFAULT_TOP_K = 3;

type CreateLocalMemoryDefinitionOptions = {
  cwd?: string;
  defaultEnabled?: boolean;
  defaultFilePath?: string;
};

export type LocalMemoryDefinition = {
  enabled: boolean;
  filePath: string;
  maxContextChars: number;
  topK: number;
};

export type LocalMemoryPluginResult = {
  plugin: HarnessPlugin | null;
  summaryLines: string[];
};

export function getDefaultLocalMemoryFilePath(cwd: string = process.cwd()): string {
  return resolve(cwd, join('tmp', 'memory', 'rag-cli.jsonl'));
}

export function getLocalMemoryDefinition(
  args: string[],
  options: CreateLocalMemoryDefinitionOptions = {},
): LocalMemoryDefinition {
  const cwd = options.cwd ?? process.cwd();
  const enabled = getBooleanFlag(args, '--memory', options.defaultEnabled ?? false);
  const configuredFilePath = getOptionalPathArg(args, '--memory-file');
  const filePath = resolve(cwd, configuredFilePath ?? options.defaultFilePath ?? getDefaultLocalMemoryFilePath(cwd));
  const topK = getOptionalIntegerArg(args, '--memory-top-k') ?? DEFAULT_TOP_K;
  const maxContextChars = getOptionalIntegerArg(args, '--memory-max-context-chars') ?? DEFAULT_MAX_CONTEXT_CHARS;

  assertPositiveInteger(topK, '--memory-top-k');
  assertPositiveInteger(maxContextChars, '--memory-max-context-chars');

  return {
    enabled,
    filePath,
    maxContextChars,
    topK,
  };
}

export async function createLocalMemoryPlugin(definition: LocalMemoryDefinition): Promise<LocalMemoryPluginResult> {
  if (!definition.enabled) {
    return {
      plugin: null,
      summaryLines: ['memory: disabled'],
    };
  }

  await mkdir(dirname(definition.filePath), { recursive: true });
  await writeFile(definition.filePath, '', { flag: 'a' });

  return {
    plugin: createJsonlMemoryPlugin({
      maxContextChars: definition.maxContextChars,
      name: 'local-memory',
      path: definition.filePath,
      topK: definition.topK,
    }),
    summaryLines: [`memory: enabled (topK=${definition.topK})`, `memory file: ${definition.filePath}`],
  };
}

function getOptionalIntegerArg(args: string[], name: string): number | undefined {
  const value = getArgValue(args, name);

  if (value === null) {
    return undefined;
  }

  if (value.trim().length === 0) {
    throw new Error(`Invalid value for ${name}: value is required.`);
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid value for ${name}: ${value}`);
  }

  return parsed;
}

function getOptionalPathArg(args: string[], name: string): string | undefined {
  const value = getArgValue(args, name);

  if (value === null) {
    return undefined;
  }

  if (value.trim().length === 0) {
    throw new Error(`Invalid value for ${name}: value is required.`);
  }

  return value;
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
}
