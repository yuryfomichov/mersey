export type ToolFileAccess = 'read' | 'write';

export type ToolPathDenyRule = {
  access?: ToolFileAccess[];
  basename?: string;
  basenamePrefix?: string;
  extension?: string;
  path?: string;
  pathPrefix?: string;
  reason?: string;
  tools?: string[];
};

export type ToolPolicy = {
  commandAllowlist?: string[];
  commandDenylist?: string[];
  defaultCommandTimeoutMs?: number;
  maxCommandOutputBytes?: number;
  maxCommandTimeoutMs?: number;
  maxReadBytes?: number;
  maxToolResultBytes?: number;
  maxWriteBytes?: number;
  pathDenylist?: ToolPathDenyRule[];
  workspaceRoot: string;
};

export type ToolCommandSpec = {
  args?: string[];
  command: string;
  cwd?: string;
  timeoutMs?: number;
};

export type ToolOutputLimitResult = {
  originalBytes: number;
  text: string;
  truncated: boolean;
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

export type ToolContext = {
  commands: {
    run(spec: ToolCommandSpec, toolName: string): Promise<ToolCommandResult>;
  };
  files: {
    assertReadSize(path: string, toolName: string): Promise<void>;
    assertWriteSize(content: string, toolName: string): void;
    resolveForRead(path: string, toolName: string): Promise<string>;
    resolveForWrite(path: string, toolName: string): Promise<string>;
  };
  output: {
    limitResult(text: string): ToolOutputLimitResult;
    limitText(text: string, maxBytes?: number): ToolOutputLimitResult;
  };
  policy: ToolPolicy;
  signal?: AbortSignal;
};
