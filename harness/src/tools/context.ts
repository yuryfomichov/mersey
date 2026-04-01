import { realpath } from 'node:fs/promises';
import { basename, extname, relative, sep } from 'node:path';

import { runCommand } from './context/commands.js';
import { getDefaultToolResultBytes, limitText } from './context/output.js';
import type {
  ToolCommandResult,
  ToolCommandSpec,
  ToolContext,
  ToolFileAccess,
  ToolOutputLimitResult,
  ToolPathDenyRule,
  ToolPolicy,
} from './context/types.js';
import { assertFileSizeWithinLimit, resolvePathInWorkspace } from './utils/file_system.js';

const DEFAULT_MAX_READ_BYTES = 64 * 1024;

function normalizePolicyPath(path: string): string {
  const normalized = path.replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/+/g, '/').replace(/\/$/, '');

  return normalized || '.';
}

function matchesPathPrefix(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

function matchesDenyRule(path: string, toolName: string, access: ToolFileAccess, rule: ToolPathDenyRule): boolean {
  if (rule.access && !rule.access.includes(access)) {
    return false;
  }

  if (rule.tools && !rule.tools.includes(toolName)) {
    return false;
  }

  const fileBasename = basename(path);
  const hasSelector = rule.path || rule.pathPrefix || rule.basename || rule.basenamePrefix || rule.extension;

  if (!hasSelector) {
    return false;
  }

  if (rule.path && normalizePolicyPath(rule.path) !== path) {
    return false;
  }

  if (rule.pathPrefix && !matchesPathPrefix(path, normalizePolicyPath(rule.pathPrefix))) {
    return false;
  }

  if (rule.basename && rule.basename !== fileBasename) {
    return false;
  }

  if (rule.basenamePrefix && !fileBasename.startsWith(rule.basenamePrefix)) {
    return false;
  }

  if (rule.extension && rule.extension !== extname(fileBasename)) {
    return false;
  }

  return true;
}

function getPolicyError(toolName: string, path: string, rule: ToolPathDenyRule): Error {
  const reason = rule.reason ? ` (${rule.reason})` : '';

  return new Error(`${toolName} path is blocked by tool policy: ${path}${reason}`);
}

function assertWriteSizeWithinLimit(content: string, maxBytes: number, toolName: string): void {
  const size = Buffer.byteLength(content, 'utf8');

  if (size > maxBytes) {
    throw new Error(`${toolName} refuses content larger than ${maxBytes} bytes.`);
  }
}

export function createToolContext(policy: ToolPolicy, options: { signal?: AbortSignal } = {}): ToolContext {
  let canonicalWorkspaceRootPromise: Promise<string> | null = null;

  async function getCanonicalWorkspaceRoot(): Promise<string> {
    if (!canonicalWorkspaceRootPromise) {
      canonicalWorkspaceRootPromise = realpath(policy.workspaceRoot);
    }

    return canonicalWorkspaceRootPromise;
  }

  async function assertPathAllowed(resolvedPath: string, toolName: string, access: ToolFileAccess): Promise<void> {
    const workspaceRoot = await getCanonicalWorkspaceRoot();
    const relativePath = normalizePolicyPath(relative(workspaceRoot, resolvedPath).split(sep).join('/'));

    for (const rule of policy.pathDenylist ?? []) {
      if (matchesDenyRule(relativePath, toolName, access, rule)) {
        throw getPolicyError(toolName, relativePath, rule);
      }
    }
  }

  return {
    commands: {
      async run(spec: ToolCommandSpec, toolName: string): Promise<ToolCommandResult> {
        return runCommand(
          spec,
          toolName,
          policy,
          getCanonicalWorkspaceRoot,
          (cwd, cwdToolName) => resolvePathInWorkspace(cwd, policy.workspaceRoot, { toolName: cwdToolName }),
          options.signal,
        );
      },
    },
    files: {
      async assertReadSize(path: string, toolName: string): Promise<void> {
        await assertFileSizeWithinLimit(path, policy.maxReadBytes ?? DEFAULT_MAX_READ_BYTES, toolName);
      },
      assertWriteSize(content: string, toolName: string): void {
        if (policy.maxWriteBytes === undefined) {
          return;
        }

        assertWriteSizeWithinLimit(content, policy.maxWriteBytes, toolName);
      },
      async resolveForRead(path: string, toolName: string): Promise<string> {
        const resolvedPath = await resolvePathInWorkspace(path, policy.workspaceRoot, { toolName });

        await assertPathAllowed(resolvedPath, toolName, 'read');
        return resolvedPath;
      },
      async resolveForWrite(path: string, toolName: string): Promise<string> {
        const resolvedPath = await resolvePathInWorkspace(path, policy.workspaceRoot, {
          allowMissing: true,
          toolName,
        });

        await assertPathAllowed(resolvedPath, toolName, 'write');
        return resolvedPath;
      },
    },
    output: {
      limitResult(text: string): ToolOutputLimitResult {
        return limitText(text, policy.maxToolResultBytes ?? getDefaultToolResultBytes());
      },
      limitText(
        text: string,
        maxBytes: number = policy.maxToolResultBytes ?? getDefaultToolResultBytes(),
      ): ToolOutputLimitResult {
        return limitText(text, maxBytes);
      },
    },
    policy,
    signal: options.signal,
  };
}

export type {
  ToolCommandResult,
  ToolCommandSpec,
  ToolContext,
  ToolFileAccess,
  ToolOutputLimitResult,
  ToolPathDenyRule,
  ToolPolicy,
} from './context/types.js';
