import { readFile, writeFile } from 'node:fs/promises';

import { z } from 'zod';

import type { ModelToolInput } from '../models/index.js';
import type { Tool } from './types.js';
import { resolvePathInWorkspace } from './utils/file_system.js';
import { parseToolInput, toToolInputSchema } from './utils/schema.js';

export type EditFileToolOptions = {
  workspaceRoot: string;
};

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

  private readonly workspaceRoot: string;

  constructor(options: EditFileToolOptions) {
    this.workspaceRoot = options.workspaceRoot;
  }

  async execute(input: ModelToolInput): Promise<string> {
    const { newText, oldText, path } = parseToolInput(EditFileTool.input, input);

    const resolvedPath = await resolvePathInWorkspace(path, this.workspaceRoot, { toolName: this.name });
    const content = await readFile(resolvedPath, 'utf8');
    const matchCount = getMatchCount(content, oldText);

    if (matchCount === 0) {
      throw new Error(`edit_file could not find oldText in file: ${resolvedPath}`);
    }

    if (matchCount !== 1) {
      throw new Error(`edit_file requires oldText to match exactly once: ${resolvedPath}`);
    }

    await writeFile(resolvedPath, content.replace(oldText, newText), 'utf8');
    return `Edited file: ${resolvedPath}`;
  }
}
