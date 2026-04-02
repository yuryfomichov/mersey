import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';

import { limitText } from '../output/output-utils.js';
import type { ToolOutputLimitResult } from '../types.js';
import type { ToolCommandPolicy, ToolCommandResult, ToolCommandSpec } from './types.js';

const DEFAULT_MAX_COMMAND_OUTPUT_BYTES = 32 * 1024;
const DEFAULT_COMMAND_TIMEOUT_MS = 10_000;
const COMMAND_KILL_GRACE_MS = 250;

function assertCommandAllowed(command: string, toolName: string, policy: ToolCommandPolicy): void {
  if (policy.commandAllowlist && !policy.commandAllowlist.includes(command)) {
    throw new Error(`${toolName} command is not in the allowlist: ${command}`);
  }

  if (policy.commandDenylist?.includes(command)) {
    throw new Error(`${toolName} command is blocked by tool policy: ${command}`);
  }
}

function resolveCommandTimeout(timeoutMs: number | undefined, toolName: string, policy: ToolCommandPolicy): number {
  const resolvedTimeout = timeoutMs ?? policy.defaultTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;

  if (resolvedTimeout <= 0) {
    throw new Error(`${toolName} timeout must be greater than 0.`);
  }

  const maxTimeout = policy.maxTimeoutMs;

  if (maxTimeout !== undefined && resolvedTimeout > maxTimeout) {
    throw new Error(`${toolName} timeout exceeds the configured maximum of ${maxTimeout} ms.`);
  }

  return resolvedTimeout;
}

function readStream(stream: NodeJS.ReadableStream | null, maxBytes: number): Promise<ToolOutputLimitResult> {
  if (!stream) {
    return Promise.resolve({ originalBytes: 0, text: '', truncated: false });
  }

  return new Promise((resolve, reject) => {
    const decoder = new StringDecoder('utf8');
    const chunks: string[] = [];
    let capturedBytes = 0;
    let totalBytes = 0;

    stream.on('data', (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);

      totalBytes += buffer.length;

      if (capturedBytes >= maxBytes) {
        return;
      }

      const remainingBytes = Math.max(maxBytes - capturedBytes, 0);

      if (remainingBytes === 0) {
        return;
      }

      const limitedBuffer = buffer.subarray(0, remainingBytes);

      capturedBytes += limitedBuffer.length;
      chunks.push(decoder.write(limitedBuffer));
    });
    stream.on('error', reject);
    stream.on('end', () => {
      const limited = limitText(`${chunks.join('')}${decoder.end()}`, maxBytes);

      resolve({
        originalBytes: totalBytes,
        text: limited.text,
        truncated: totalBytes > maxBytes || limited.truncated,
      });
    });
  });
}

export async function runCommand(
  spec: ToolCommandSpec,
  toolName: string,
  policy: ToolCommandPolicy,
  getDefaultCwd: () => Promise<string>,
  resolveCwd: (cwd: string, toolName: string) => Promise<string>,
  signal?: AbortSignal,
): Promise<ToolCommandResult> {
  assertCommandAllowed(spec.command, toolName, policy);
  signal?.throwIfAborted();

  const timeoutMs = resolveCommandTimeout(spec.timeoutMs, toolName, policy);
  const cwd = spec.cwd ? await resolveCwd(spec.cwd, toolName) : await getDefaultCwd();
  const startedAt = Date.now();
  const maxOutputBytes = policy.maxOutputBytes ?? DEFAULT_MAX_COMMAND_OUTPUT_BYTES;

  const child = spawn(spec.command, spec.args ?? [], {
    cwd,
    shell: false,
    signal,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let exited = false;
  let timedOut = false;
  let killTimeout: NodeJS.Timeout | null = null;
  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill('SIGTERM');

    killTimeout = setTimeout(() => {
      if (!exited) {
        child.kill('SIGKILL');
      }
    }, COMMAND_KILL_GRACE_MS);
  }, timeoutMs);

  try {
    const [stdout, stderr, exit] = await Promise.all([
      readStream(child.stdout, maxOutputBytes),
      readStream(child.stderr, maxOutputBytes),
      new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
        child.on('error', reject);
        child.on('close', (exitCode, signal) => {
          exited = true;
          resolve({ exitCode, signal });
        });
      }),
    ]);

    return {
      args: spec.args ?? [],
      command: spec.command,
      cwd,
      durationMs: Date.now() - startedAt,
      exitCode: exit.exitCode,
      signal: exit.signal,
      stderr: stderr.text,
      stderrBytes: stderr.originalBytes,
      stderrTruncated: stderr.truncated,
      stdout: stdout.text,
      stdoutBytes: stdout.originalBytes,
      stdoutTruncated: stdout.truncated,
      timedOut,
    };
  } finally {
    clearTimeout(timeout);
    if (killTimeout) {
      clearTimeout(killTimeout);
    }
  }
}
