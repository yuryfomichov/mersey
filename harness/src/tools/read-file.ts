import { readFile, realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';

import type { ModelToolInput } from '../models/index.js';
import type { Tool } from './types.js';

const DEFAULT_MAX_BYTES = 64 * 1024;

export type ReadFileToolOptions = {
  maxBytes?: number;
  workspaceRoot: string;
};

function resolveToolPath(path: string, workspaceRoot: string): string {
  return isAbsolute(path) ? path : resolve(workspaceRoot, path);
}

async function assertPathInWorkspace(path: string, workspaceRoot: string): Promise<void> {
  const relativeResolvedPath = relative(workspaceRoot, path);

  if (relativeResolvedPath.startsWith('..') || isAbsolute(relativeResolvedPath)) {
    throw new Error(`read_file path must stay inside workspace root: ${path}`);
  }

  const canonicalPath = await realpath(path);
  const relativeCanonicalPath = relative(workspaceRoot, canonicalPath);

  if (!relativeCanonicalPath || (!relativeCanonicalPath.startsWith('..') && !isAbsolute(relativeCanonicalPath))) {
    return;
  }

  throw new Error(`read_file path must stay inside workspace root: ${path}`);
}

async function assertFileSizeWithinLimit(path: string, maxBytes: number): Promise<void> {
  const file = await stat(path);

  if (file.size > maxBytes) {
    throw new Error(`read_file refuses files larger than ${maxBytes} bytes: ${path}`);
  }
}

export class ReadFileTool implements Tool {
  readonly description = 'Read a UTF-8 text file from disk.';
  readonly inputSchema = {
    properties: {
      path: {
        description: 'Absolute path or a path relative to the workspace root.',
        type: 'string',
      },
    },
    required: ['path'],
    type: 'object' as const,
  };
  readonly name = 'read_file';

  private readonly maxBytes: number;
  private readonly workspaceRoot: string;

  constructor(options: ReadFileToolOptions) {
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    this.workspaceRoot = options.workspaceRoot;
  }

  async execute(input: ModelToolInput): Promise<string> {
    const path = input.path;

    if (typeof path !== 'string' || !path) {
      throw new Error('read_file requires a string path.');
    }

    const canonicalWorkspaceRoot = await realpath(this.workspaceRoot);
    const resolvedPath = resolveToolPath(path, canonicalWorkspaceRoot);

    await assertPathInWorkspace(resolvedPath, canonicalWorkspaceRoot);
    await assertFileSizeWithinLimit(resolvedPath, this.maxBytes);
    return readFile(resolvedPath, 'utf8');
  }
}
