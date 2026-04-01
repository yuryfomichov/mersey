import { readFile, writeFile } from 'node:fs/promises';

import { z } from 'zod';

import type { ModelToolInput } from '../models/types.js';
import type { ToolContext } from './context.js';
import type { Tool, ToolExecuteResult } from './types.js';
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

  readonly description = 'Edit a UTF-8 text file by replacing exactly one matching string.';
  readonly inputSchema = toToolInputSchema(EditFileTool.input);
  readonly name = 'edit_file';

  async execute(input: ModelToolInput, context: ToolContext): Promise<ToolExecuteResult> {
    const { newText, oldText, path } = parseToolInput(EditFileTool.input, input);

    const resolvedPath = await context.files.resolveForRead(path, this.name);
    await context.files.resolveForWrite(path, this.name);
    await context.files.assertReadSize(resolvedPath, this.name);
    const content = await readFile(resolvedPath, 'utf8');
    const matchCount = getMatchCount(content, oldText);

    if (matchCount === 0) {
      throw new Error(`edit_file could not find oldText in file: ${resolvedPath}`);
    }

    if (matchCount !== 1) {
      throw new Error(`edit_file requires oldText to match exactly once: ${resolvedPath}`);
    }

    const nextContent = content.replace(oldText, newText);

    context.files.assertWriteSize(nextContent, this.name);
    await writeFile(resolvedPath, nextContent, 'utf8');
    return {
      content: `Edited file: ${resolvedPath}`,
      data: {
        path: resolvedPath,
      },
    };
  }
}
