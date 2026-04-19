import { constants } from 'node:fs';
import { open } from 'node:fs/promises';

import { z } from 'zod';

import { FileService } from './services/files/file-service.js';
import type {
  ToolExecutionContext,
  ToolExecutionPolicy,
  ToolFileService,
  ToolOutputService,
} from './services/index.js';
import { OutputService } from './services/output/output-service.js';
import type { Tool, ToolExecuteResult, ToolInput } from './types.js';
import { createCanonicalWorkspaceRootGetter, resolveToolExecutionPolicy } from './utils/policy.js';
import { parseToolInput, toToolInputSchema } from './utils/schema.js';

export type ReadFileToolOptions = {
  policy?: ToolExecutionPolicy;
};

export class ReadFileTool implements Tool {
  private static readonly input = z.object({
    path: z
      .string({ error: 'read_file requires a string path.' })
      .min(1, { error: 'read_file requires a string path.' })
      .describe('Absolute path or a path relative to the workspace root.'),
  });

  private readonly files: ToolFileService;
  private readonly output: ToolOutputService;

  readonly description = 'Read a UTF-8 text file from disk.';
  readonly inputSchema = toToolInputSchema(ReadFileTool.input);
  readonly name = 'read_file';

  constructor(options: ReadFileToolOptions = {}) {
    const policy = resolveToolExecutionPolicy(options.policy);
    const getCanonicalWorkspaceRoot = createCanonicalWorkspaceRootGetter(policy.workspaceRoot);

    this.files = new FileService({ getCanonicalWorkspaceRoot, policy });
    this.output = new OutputService(policy);
  }

  async execute(input: ToolInput, context: ToolExecutionContext): Promise<ToolExecuteResult> {
    const { path } = parseToolInput(ReadFileTool.input, input);

    context.cancellation.throwIfAborted();
    const resolvedPath = await this.files.resolveForRead(path, this.name);
    const fileHandle = await open(resolvedPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    let content: string;

    try {
      const file = await fileHandle.stat();

      if (file.size > this.files.getMaxReadBytes()) {
        throw new Error(
          `${this.name} refuses files larger than ${this.files.getMaxReadBytes()} bytes: ${resolvedPath}`,
        );
      }

      content = await fileHandle.readFile({ encoding: 'utf8' });
    } finally {
      await fileHandle.close();
    }

    context.cancellation.throwIfAborted();
    const limited = this.output.limitResult(content);

    return {
      content: limited.text,
      data: {
        path: resolvedPath,
        truncated: limited.truncated,
      },
    };
  }
}
