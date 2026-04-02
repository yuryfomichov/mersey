import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { createHarness as createBaseHarness, type CreateHarnessOptions } from './harness.js';
import { MemorySessionStore } from './sessions/memory-store.js';
import { Session } from './sessions/session.js';
import type { SessionStore } from './sessions/store.js';

export type TestHarnessOptions = Omit<CreateHarnessOptions, 'session'> & {
  session?: Session;
  sessionId?: string;
  sessionStore?: SessionStore;
};

export function createTestSession(
  sessionStore: SessionStore = new MemorySessionStore(),
  sessionId = 'local-session',
): Session {
  return new Session({
    id: sessionId,
    store: sessionStore,
  });
}

export function createTestHarness(options: TestHarnessOptions = {}) {
  const { session: providedSession, sessionId, sessionStore, ...rest } = options;

  return createBaseHarness({
    ...rest,
    session:
      providedSession ?? createTestSession(sessionStore ?? new MemorySessionStore(), sessionId ?? 'local-session'),
  });
}

export async function withTempDir<T>(run: (rootDir: string) => Promise<T>, prefix = 'mersey-'): Promise<T> {
  const rootDir = await mkdtemp(join(tmpdir(), prefix));

  try {
    return await run(rootDir);
  } finally {
    await rm(rootDir, { force: true, recursive: true });
  }
}

export async function writeWorkspaceFiles(rootDir: string, files: Record<string, string>): Promise<void> {
  await Promise.all(
    Object.entries(files).map(async ([relativePath, content]) => {
      const filePath = join(rootDir, relativePath);

      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, content, 'utf8');
    }),
  );
}

export async function collectChunks<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const chunks: T[] = [];

  for await (const chunk of iterable) {
    chunks.push(chunk);
  }

  return chunks;
}
