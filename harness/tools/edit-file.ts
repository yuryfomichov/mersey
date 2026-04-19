import { constants } from 'node:fs';
import { open } from 'node:fs/promises';

import { z } from 'zod';

import { FileService } from './services/files/file-service.js';
import type { ToolExecutionContext, ToolExecutionPolicy, ToolFileService } from './services/index.js';
import type { Tool, ToolExecuteResult, ToolInput } from './types.js';
import { createCanonicalWorkspaceRootGetter, resolveToolExecutionPolicy } from './utils/policy.js';
import { parseToolInput, toToolInputSchema } from './utils/schema.js';

function getMatchCount(content: string, oldText: string): number {
  let count = 0;
  let startIndex = 0;

  while (true) {
    const matchIndex = content.indexOf(oldText, startIndex);

    if (matchIndex === -1) {
      return count;
    }

    count += 1;
    startIndex = matchIndex + 1;
  }
}

export type EditFileToolOptions = {
  policy?: ToolExecutionPolicy;
};

export class EditFileTool implements Tool {
  private static readonly input = z.object({
    newText: z
      .string({ error: 'edit_file requires string newText.' })
      .describe('Replacement text for the matched content.'),
    oldText: z
      .string({ error: 'edit_file requires string oldText.' })
      .min(1, { error: 'edit_file requires a non-empty oldText.' })
      .describe('Existing text to replace. It must appear exactly once.'),
    path: z
      .string({ error: 'edit_file requires a string path.' })
      .min(1, { error: 'edit_file requires a string path.' })
      .describe('Absolute path or a path relative to the workspace root.'),
  });

  private readonly files: ToolFileService;

  readonly description = 'Edit a UTF-8 text file by replacing exactly one matching string.';
  readonly inputSchema = toToolInputSchema(EditFileTool.input);
  readonly name = 'edit_file';

  constructor(options: EditFileToolOptions = {}) {
    const policy = resolveToolExecutionPolicy(options.policy);
    const getCanonicalWorkspaceRoot = createCanonicalWorkspaceRootGetter(policy.workspaceRoot);

    this.files = new FileService({ getCanonicalWorkspaceRoot, policy });
  }

  async execute(input: ToolInput, context: ToolExecutionContext): Promise<ToolExecuteResult> {
    const { newText, oldText, path } = parseToolInput(EditFileTool.input, input);

    context.cancellation.throwIfAborted();
    const resolvedPath = await this.files.resolveForReadWrite(path, this.name);
    const fileHandle = await open(resolvedPath, constants.O_RDWR | constants.O_NOFOLLOW);
    try {
      const file = await fileHandle.stat();

      if (file.size > this.files.getMaxReadBytes()) {
        throw new Error(
          `${this.name} refuses files larger than ${this.files.getMaxReadBytes()} bytes: ${resolvedPath}`,
        );
      }

      const content = await fileHandle.readFile({ encoding: 'utf8' });
      const matchCount = getMatchCount(content, oldText);

      if (matchCount === 0) {
        throw new Error(`edit_file could not find oldText in file: ${resolvedPath}`);
      }

      if (matchCount !== 1) {
        throw new Error(`edit_file requires oldText to match exactly once: ${resolvedPath}`);
      }

      const nextContent = content.replace(oldText, newText);
      const nextBuffer = Buffer.from(nextContent, 'utf8');

      this.files.assertWriteSize(nextContent, this.name);

      await fileHandle.truncate(0);

      let written = 0;

      while (written < nextBuffer.length) {
        const result = await fileHandle.write(nextBuffer, written, nextBuffer.length - written, written);

        written += result.bytesWritten;
      }
    } finally {
      await fileHandle.close();
    }

    context.cancellation.throwIfAborted();

    return {
      content: `Edited file: ${resolvedPath}`,
      data: {
        path: resolvedPath,
      },
    };
  }
}
