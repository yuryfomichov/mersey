import { readFile } from 'node:fs/promises';
import { z } from 'zod';

import type { ModelToolInput } from '../models/types.js';
import type { ToolContext } from './context.js';
import type { Tool, ToolExecuteResult } from './types.js';
import { parseToolInput, toToolInputSchema } from './utils/schema.js';

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

  async execute(input: ModelToolInput, context: ToolContext): Promise<ToolExecuteResult> {
    const { path } = parseToolInput(ReadFileTool.input, input);

    const resolvedPath = await context.files.resolveForRead(path, this.name);
    await context.files.assertReadSize(resolvedPath, this.name);
    const content = await readFile(resolvedPath, 'utf8');
    const limited = context.output.limitResult(content);

    return {
      content: limited.text,
      data: {
        path: resolvedPath,
        truncated: limited.truncated,
      },
    };
  }
}
