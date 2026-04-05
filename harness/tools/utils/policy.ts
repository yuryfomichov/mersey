import { realpath } from 'node:fs/promises';

import type { ToolExecutionPolicy } from '../services/index.js';

export function resolveToolExecutionPolicy(policy?: ToolExecutionPolicy): ToolExecutionPolicy {
  return policy ?? { workspaceRoot: process.cwd() };
}

export function createCanonicalWorkspaceRootGetter(workspaceRoot: string): () => Promise<string> {
  let canonicalWorkspaceRoot: string | null = null;
  let canonicalWorkspaceRootPromise: Promise<string> | null = null;

  return async (): Promise<string> => {
    if (canonicalWorkspaceRoot) {
      return canonicalWorkspaceRoot;
    }

    if (!canonicalWorkspaceRootPromise) {
      canonicalWorkspaceRootPromise = realpath(workspaceRoot)
        .then((resolvedWorkspaceRoot) => {
          canonicalWorkspaceRoot = resolvedWorkspaceRoot;
          return resolvedWorkspaceRoot;
        })
        .finally(() => {
          canonicalWorkspaceRootPromise = null;
        });
    }

    return canonicalWorkspaceRootPromise;
  };
}
