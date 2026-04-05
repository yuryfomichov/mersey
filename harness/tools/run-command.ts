import { z } from 'zod';

import { CommandService } from './services/commands/command-service.js';
import type { ToolCommandPolicy, ToolCommandResult } from './services/commands/types.js';
import { resolvePathInWorkspace } from './services/files/path-utils.js';
import type { ToolExecutionContext, ToolExecutionPolicy, ToolOutputService } from './services/index.js';
import { OutputService } from './services/output/output-service.js';
import type { Tool, ToolExecuteResult, ToolInput } from './types.js';
import { createCanonicalWorkspaceRootGetter, resolveToolExecutionPolicy } from './utils/policy.js';
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

export type RunCommandToolOptions = ToolCommandPolicy & {
  policy?: ToolExecutionPolicy;
};

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

  private readonly commandPolicy: ToolCommandPolicy;
  private readonly output: ToolOutputService;
  private readonly policy: ToolExecutionPolicy;
  private readonly getCanonicalWorkspaceRoot: () => Promise<string>;

  readonly description =
    'Run one allowed executable directly inside the workspace without a shell. Put the executable in `command` and only trailing arguments in `args`. Example: `{ "command": "pwd" }` or `{ "command": "git", "args": ["status"] }`.';
  readonly inputSchema = toToolInputSchema(RunCommandTool.input);
  readonly name = 'run_command';

  constructor(options: RunCommandToolOptions = {}) {
    this.policy = resolveToolExecutionPolicy(options.policy);
    this.getCanonicalWorkspaceRoot = createCanonicalWorkspaceRootGetter(this.policy.workspaceRoot);
    this.output = new OutputService(this.policy);
    this.commandPolicy = {
      commandAllowlist: options.commandAllowlist,
      commandDenylist: options.commandDenylist,
      defaultTimeoutMs: options.defaultTimeoutMs,
      maxOutputBytes: options.maxOutputBytes,
      maxTimeoutMs: options.maxTimeoutMs,
    };
  }

  async execute(input: ToolInput, context: ToolExecutionContext): Promise<ToolExecuteResult> {
    const parsedSpec = parseToolInput(RunCommandTool.input, input);
    const spec =
      parsedSpec.args?.length === 1 &&
      parsedSpec.args[0] === parsedSpec.command &&
      ZERO_ARG_COMMANDS.has(parsedSpec.command)
        ? { ...parsedSpec, args: [] }
        : parsedSpec;
    const commands = new CommandService({
      cancellation: context.cancellation,
      getDefaultCwd: this.getCanonicalWorkspaceRoot,
      resolveCwd: (cwd, cwdToolName) =>
        resolvePathInWorkspace(cwd, this.policy.workspaceRoot, { toolName: cwdToolName }),
    });
    const result = await commands.run(spec, this.name, this.commandPolicy);
    context.cancellation.throwIfAborted();
    const content = this.output.limitResult(toResultContent(result));

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
