import { runCommand } from './command-utils.js';
import type { ToolCommandPolicy, ToolCommandResult, ToolCommandRunner, ToolCommandSpec } from './types.js';

type CommandServiceOptions = {
  getDefaultCwd: () => Promise<string>;
  resolveCwd: (cwd: string, toolName: string) => Promise<string>;
  signal?: AbortSignal;
};

export class CommandService implements ToolCommandRunner {
  constructor(private readonly options: CommandServiceOptions) {}

  run(spec: ToolCommandSpec, toolName: string, policy: ToolCommandPolicy = {}): Promise<ToolCommandResult> {
    return runCommand(spec, toolName, policy, this.options.getDefaultCwd, this.options.resolveCwd, this.options.signal);
  }
}
