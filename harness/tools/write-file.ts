import { constants } from 'node:fs';
import { mkdir, open } from 'node:fs/promises';
import { dirname } from 'node:path';

import { z } from 'zod';

import { FileService } from './services/files/file-service.js';
import type { ToolExecutionContext, ToolExecutionPolicy, ToolFileService } from './services/index.js';
import type { Tool, ToolExecuteResult, ToolInput } from './types.js';
import { createCanonicalWorkspaceRootGetter, resolveToolExecutionPolicy } from './utils/policy.js';
import { parseToolInput, toToolInputSchema } from './utils/schema.js';

export type WriteFileToolOptions = {
  policy?: ToolExecutionPolicy;
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

  private readonly files: ToolFileService;

  readonly description = 'Write a UTF-8 text file to disk.';
  readonly inputSchema = toToolInputSchema(WriteFileTool.input);
  readonly name = 'write_file';

  constructor(options: WriteFileToolOptions = {}) {
    const policy = resolveToolExecutionPolicy(options.policy);
    const getCanonicalWorkspaceRoot = createCanonicalWorkspaceRootGetter(policy.workspaceRoot);

    this.files = new FileService({ getCanonicalWorkspaceRoot, policy });
  }

  async execute(input: ToolInput, context: ToolExecutionContext): Promise<ToolExecuteResult> {
    const { content, overwrite, path } = parseToolInput(WriteFileTool.input, input);

    context.cancellation.throwIfAborted();
    const resolvedPath = await this.files.resolveForWrite(path, this.name);
    this.files.assertWriteSize(content, this.name);

    await mkdir(dirname(resolvedPath), { recursive: true });

    try {
      const fileHandle = await open(
        resolvedPath,
        overwrite
          ? constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW
          : constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        0o666,
      );

      try {
        await fileHandle.writeFile(content, { encoding: 'utf8' });
      } finally {
        await fileHandle.close();
      }
    } catch (error: unknown) {
      const errorCode = error instanceof Error && 'code' in error ? error.code : undefined;

      if (errorCode === 'EEXIST') {
        throw new Error(`write_file refuses to overwrite existing files: ${resolvedPath}`);
      }

      throw error;
    }

    context.cancellation.throwIfAborted();

    return {
      content: `Wrote file: ${resolvedPath}`,
      data: {
        overwritten: Boolean(overwrite),
        path: resolvedPath,
      },
    };
  }
}
