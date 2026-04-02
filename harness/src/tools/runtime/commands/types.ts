export type ToolCommandSpec = {
  args?: string[];
  command: string;
  cwd?: string;
  timeoutMs?: number;
};

export type ToolCommandResult = {
  args: string[];
  command: string;
  cwd: string;
  durationMs: number;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stderr: string;
  stderrBytes: number;
  stderrTruncated: boolean;
  stdout: string;
  stdoutBytes: number;
  stdoutTruncated: boolean;
  timedOut: boolean;
};

export type ToolCommandPolicy = {
  commandAllowlist?: string[];
  commandDenylist?: string[];
  defaultTimeoutMs?: number;
  maxOutputBytes?: number;
  maxTimeoutMs?: number;
};

export type ToolCommandRunner = {
  run(spec: ToolCommandSpec, toolName: string, policy?: ToolCommandPolicy): Promise<ToolCommandResult>;
};
