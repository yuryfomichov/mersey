import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { z } from 'zod';

import type { ModelToolInput } from '../models/index.js';
import type { Tool } from './types.js';
import { resolvePathInWorkspace } from './utils/file_system.js';
import { parseToolInput, toToolInputSchema } from './utils/schema.js';

export type WriteFileToolOptions = {
  workspaceRoot: string;
};

export class WriteFileTool implements Tool {
  private static readonly input = z.object({
    content: z
      .string({ error: 'write_file requires string content.' })
      .describe('UTF-8 text content to write to the file.'),
    overwrite: z.boolean().optional().describe('Whether to overwrite an existing file. Defaults to false.'),
    path: z
      .string({ error: 'write_file requires a string path.' })
      .min(1, { error: 'write_file requires a string path.' })
      .describe('Absolute path or a path relative to the workspace root.'),
  });

  readonly description = 'Write a UTF-8 text file to disk.';
  readonly inputSchema = toToolInputSchema(WriteFileTool.input);
  readonly name = 'write_file';

  private readonly workspaceRoot: string;

  constructor(options: WriteFileToolOptions) {
    this.workspaceRoot = options.workspaceRoot;
  }

  async execute(input: ModelToolInput): Promise<string> {
    const { content, overwrite, path } = parseToolInput(WriteFileTool.input, input);

    const resolvedPath = await resolvePathInWorkspace(path, this.workspaceRoot, {
      allowMissing: true,
      toolName: this.name,
    });

    await mkdir(dirname(resolvedPath), { recursive: true });

    try {
      await writeFile(resolvedPath, content, { encoding: 'utf8', flag: overwrite ? 'w' : 'wx' });
    } catch (error: unknown) {
      const errorCode = error instanceof Error && 'code' in error ? error.code : undefined;

      if (errorCode === 'EEXIST') {
        throw new Error(`write_file refuses to overwrite existing files: ${resolvedPath}`);
      }

      throw error;
    }

    return `Wrote file: ${resolvedPath}`;
  }
}
