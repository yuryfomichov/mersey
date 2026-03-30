import { readFile } from 'node:fs/promises';
import { z } from 'zod';

import type { ModelToolInput } from '../models/index.js';
import type { Tool } from './types.js';
import { assertFileSizeWithinLimit, resolvePathInWorkspace } from './utils/file_system.js';
import { parseToolInput, toToolInputSchema } from './utils/schema.js';

const DEFAULT_MAX_BYTES = 64 * 1024;

export type ReadFileToolOptions = {
  maxBytes?: number;
  workspaceRoot: string;
};

export class ReadFileTool implements Tool {
  private static readonly input = z.object({
    path: z
      .string({ error: 'read_file requires a string path.' })
      .min(1, { error: 'read_file requires a string path.' })
      .describe('Absolute path or a path relative to the workspace root.'),
  });

  readonly description = 'Read a UTF-8 text file from disk.';
  readonly inputSchema = toToolInputSchema(ReadFileTool.input);
  readonly name = 'read_file';

  private readonly maxBytes: number;
  private readonly workspaceRoot: string;

  constructor(options: ReadFileToolOptions) {
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    this.workspaceRoot = options.workspaceRoot;
  }

  async execute(input: ModelToolInput): Promise<string> {
    const { path } = parseToolInput(ReadFileTool.input, input);

    const resolvedPath = await resolvePathInWorkspace(path, this.workspaceRoot, { toolName: this.name });

    await assertFileSizeWithinLimit(resolvedPath, this.maxBytes, this.name);
    return readFile(resolvedPath, 'utf8');
  }
}
