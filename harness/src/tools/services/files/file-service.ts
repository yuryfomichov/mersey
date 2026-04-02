import { relative, sep } from 'node:path';

import type { ToolFileService, ToolFileAccess, ToolExecutionPolicy } from '../types.js';
import {
  assertWriteSizeWithinLimit,
  getPolicyError,
  matchesDenyRule,
  normalizeRelativePolicyPath,
} from './file-utils.js';
import { assertFileSizeWithinLimit, resolvePathInWorkspace } from './path-utils.js';

const DEFAULT_MAX_READ_BYTES = 64 * 1024;

type FileServiceOptions = {
  getCanonicalWorkspaceRoot: () => Promise<string>;
  policy: ToolExecutionPolicy;
};

export class FileService implements ToolFileService {
  constructor(private readonly options: FileServiceOptions) {}

  async assertReadSize(path: string, toolName: string): Promise<void> {
    await assertFileSizeWithinLimit(path, this.options.policy.maxReadBytes ?? DEFAULT_MAX_READ_BYTES, toolName);
  }

  assertWriteSize(content: string, toolName: string): void {
    if (this.options.policy.maxWriteBytes === undefined) {
      return;
    }

    assertWriteSizeWithinLimit(content, this.options.policy.maxWriteBytes, toolName);
  }

  async resolveForRead(path: string, toolName: string): Promise<string> {
    const resolvedPath = await resolvePathInWorkspace(path, this.options.policy.workspaceRoot, { toolName });

    await this.assertPathAllowed(resolvedPath, toolName, 'read');
    return resolvedPath;
  }

  async resolveForWrite(path: string, toolName: string): Promise<string> {
    const resolvedPath = await resolvePathInWorkspace(path, this.options.policy.workspaceRoot, {
      allowMissing: true,
      toolName,
    });

    await this.assertPathAllowed(resolvedPath, toolName, 'write');
    return resolvedPath;
  }

  private async assertPathAllowed(resolvedPath: string, toolName: string, access: ToolFileAccess): Promise<void> {
    const workspaceRoot = await this.options.getCanonicalWorkspaceRoot();
    const relativePath = normalizeRelativePolicyPath(relative(workspaceRoot, resolvedPath).split(sep).join('/'));

    for (const rule of this.options.policy.pathDenylist ?? []) {
      if (matchesDenyRule(relativePath, toolName, access, rule)) {
        throw getPolicyError(toolName, relativePath, rule);
      }
    }
  }
}
