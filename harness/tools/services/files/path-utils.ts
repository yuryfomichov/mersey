import { realpath, stat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

type ResolvePathInWorkspaceOptions = {
  allowMissing?: boolean;
  toolName: string;
};

function isPathInWorkspace(path: string, workspaceRoot: string): boolean {
  const relativePath = relative(workspaceRoot, path);

  return (
    relativePath === '' || (relativePath !== '..' && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath))
  );
}

function getWorkspacePathError(path: string, toolName: string): Error {
  return new Error(`${toolName} path must stay inside workspace root: ${path}`);
}

async function resolveMissingPath(path: string): Promise<string> {
  let currentPath = path;
  const missingSegments: string[] = [];

  while (true) {
    try {
      const canonicalPath = await realpath(currentPath);

      return missingSegments.length > 0 ? join(canonicalPath, ...missingSegments) : canonicalPath;
    } catch (error: unknown) {
      const errorCode = error instanceof Error && 'code' in error ? error.code : undefined;

      if (errorCode !== 'ENOENT' && errorCode !== 'ENOTDIR') {
        throw error;
      }

      const parentPath = dirname(currentPath);

      if (parentPath === currentPath) {
        throw error;
      }

      missingSegments.unshift(basename(currentPath));
      currentPath = parentPath;
    }
  }
}

export async function assertFileSizeWithinLimit(path: string, maxBytes: number, toolName: string): Promise<void> {
  const file = await stat(path);

  if (file.size > maxBytes) {
    throw new Error(`${toolName} refuses files larger than ${maxBytes} bytes: ${path}`);
  }
}

export async function resolvePathInWorkspace(
  path: string,
  workspaceRoot: string,
  options: ResolvePathInWorkspaceOptions,
): Promise<string> {
  const canonicalWorkspaceRoot = await realpath(workspaceRoot);
  const resolvedPath = isAbsolute(path) ? path : resolve(canonicalWorkspaceRoot, path);

  if (!isPathInWorkspace(resolvedPath, canonicalWorkspaceRoot)) {
    throw getWorkspacePathError(resolvedPath, options.toolName);
  }

  const comparablePath = options.allowMissing ? await resolveMissingPath(resolvedPath) : await realpath(resolvedPath);

  if (!isPathInWorkspace(comparablePath, canonicalWorkspaceRoot)) {
    throw getWorkspacePathError(resolvedPath, options.toolName);
  }

  return comparablePath;
}
