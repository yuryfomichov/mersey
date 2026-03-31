import { z } from 'zod';

import type { ModelToolInput } from '../models/index.js';
import type { ToolCommandResult, ToolContext } from './context.js';
import type { Tool, ToolExecuteResult } from './types.js';
import { parseToolInput, toToolInputSchema } from './utils/schema.js';

const ZERO_ARG_COMMANDS = new Set(['pwd']);

function toResultContent(result: ToolCommandResult): string {
  const lines = [
    `command: ${result.command}`,
    `args: ${JSON.stringify(result.args)}`,
    `cwd: ${result.cwd}`,
    `exitCode: ${String(result.exitCode)}`,
    `signal: ${result.signal ?? 'null'}`,
    `timedOut: ${String(result.timedOut)}`,
    `durationMs: ${result.durationMs}`,
    '',
    'stdout:',
    result.stdout || '(empty)',
    '',
    'stderr:',
    result.stderr || '(empty)',
  ];

  if (result.stdoutTruncated || result.stderrTruncated) {
    lines.push('', 'truncated: true');
  }

  return lines.join('\n');
}

export class RunCommandTool implements Tool {
  private static readonly input = z.object({
    args: z
      .array(z.string({ error: 'run_command args must be strings.' }))
      .optional()
      .describe(
        'Arguments after the executable only. Do not repeat command here. Example: for `git status`, use command=`git` and args=`["status"]`. For `pwd`, omit args.',
      ),
    command: z
      .string({ error: 'run_command requires a string command.' })
      .min(1, { error: 'run_command requires a string command.' })
      .describe(
        'Executable name only, run directly without a shell. Do not include the command again in args and do not use shell wrappers like `bash -lc`. Example: `pwd` or `git`.',
      ),
    cwd: z
      .string()
      .min(1)
      .optional()
      .describe(
        'Optional working directory inside the workspace. Use an absolute path or a path relative to the workspace root.',
      ),
    timeoutMs: z
      .number()
      .int()
      .positive()
      .optional()
      .describe(
        'Optional timeout in milliseconds. Use this only when the command may take longer than the default limit.',
      ),
  });

  readonly description =
    'Run one allowed executable directly inside the workspace without a shell. Put the executable in `command` and only trailing arguments in `args`. Example: `{ "command": "pwd" }` or `{ "command": "git", "args": ["status"] }`.';
  readonly inputSchema = toToolInputSchema(RunCommandTool.input);
  readonly name = 'run_command';

  async execute(input: ModelToolInput, context: ToolContext): Promise<ToolExecuteResult> {
    const parsedSpec = parseToolInput(RunCommandTool.input, input);
    const spec =
      parsedSpec.args?.length === 1 &&
      parsedSpec.args[0] === parsedSpec.command &&
      ZERO_ARG_COMMANDS.has(parsedSpec.command)
        ? { ...parsedSpec, args: [] }
        : parsedSpec;
    const result = await context.commands.run(spec, this.name);
    const content = context.output.limitResult(toResultContent(result));

    return {
      content: content.text,
      data: {
        ...result,
        contentBytes: content.originalBytes,
        contentTruncated: content.truncated,
      },
      isError: result.timedOut || result.exitCode !== 0,
    };
  }
}
