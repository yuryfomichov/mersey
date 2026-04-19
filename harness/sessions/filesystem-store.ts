import { mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { createEmptyModelUsage } from '../runtime/models/types.js';
import type { SessionStore } from '../runtime/sessions/store.js';
import type { Message, SessionState, StoredSessionState } from '../runtime/sessions/types.js';
import { SessionTurnLockMap } from './exclusive.js';
import { cloneStoredSession, commitSessionTurn } from './store-state.js';
import { assertValidSessionId } from './utils.js';

export type FilesystemSessionStoreOptions = {
  rootDir?: string;
};

type SessionLockContents = {
  createdAt: number;
  pid: number;
};

function isErrnoCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}

const LOCK_RETRY_MS = 10;
const LOCK_STARTUP_GRACE_MS = 100;

export class FilesystemSessionStore implements SessionStore {
  private static readonly processLocks = new SessionTurnLockMap();
  private readonly rootDir: string;

  constructor(options: FilesystemSessionStoreOptions = {}) {
    this.rootDir = options.rootDir ?? join(process.cwd(), 'tmp', 'sessions');
  }

  async commitTurn(sessionId: string, turnMessages: readonly Message[]): Promise<StoredSessionState> {
    const turnSnapshot = turnMessages.map((message) => structuredClone(message));

    return FilesystemSessionStore.processLocks.runExclusive(this.getLockKey(sessionId), async () =>
      this.withSessionLock(sessionId, async () => this.commitTurnUnlocked(sessionId, turnSnapshot)),
    );
  }

  async commitTurnExclusive(sessionId: string, turnMessages: readonly Message[]): Promise<StoredSessionState> {
    const turnSnapshot = turnMessages.map((message) => structuredClone(message));

    return this.commitTurnUnlocked(sessionId, turnSnapshot);
  }

  async createSession(session: SessionState): Promise<StoredSessionState> {
    const existingSession = await this.getSession(session.id);

    if (existingSession) {
      return existingSession;
    }

    const storedSession: StoredSessionState = {
      contextSize: 0,
      createdAt: session.createdAt,
      id: session.id,
      messages: [],
      usage: createEmptyModelUsage(),
    };

    const sessionDir = this.getSessionDir(session.id);

    await mkdir(sessionDir, { recursive: true });

    try {
      await writeFile(this.getSessionPath(session.id), `${JSON.stringify(storedSession, null, 2)}\n`, {
        encoding: 'utf8',
        flag: 'wx',
      });
    } catch (error: unknown) {
      if (isErrnoCode(error, 'EEXIST')) {
        const concurrentSession = await this.getSession(session.id);

        if (concurrentSession) {
          return concurrentSession;
        }
      }

      throw error;
    }

    return storedSession;
  }

  async getSession(sessionId: string): Promise<StoredSessionState | null> {
    try {
      return await this.readSession(sessionId);
    } catch (error: unknown) {
      if (isErrnoCode(error, 'ENOENT')) {
        return null;
      }

      throw error;
    }
  }

  async runExclusive<T>(sessionId: string, run: () => Promise<T>): Promise<T> {
    return FilesystemSessionStore.processLocks.runExclusive(this.getLockKey(sessionId), async () =>
      this.withSessionLock(sessionId, run),
    );
  }

  private async commitTurnUnlocked(sessionId: string, turnMessages: readonly Message[]): Promise<StoredSessionState> {
    const existingSession = await this.getSession(sessionId);

    if (!existingSession) {
      throw new Error(`Session does not exist: ${sessionId}`);
    }

    const committedSession = commitSessionTurn(existingSession, turnMessages);
    await this.writeSession(sessionId, committedSession);
    return cloneStoredSession(committedSession);
  }

  private getSessionDir(sessionId: string): string {
    assertValidSessionId(sessionId);
    return join(this.rootDir, sessionId);
  }

  private getSessionPath(sessionId: string): string {
    return join(this.getSessionDir(sessionId), 'session.json');
  }

  private getLockKey(sessionId: string): string {
    return `${this.rootDir}:${sessionId}`;
  }

  private getLockPath(sessionId: string): string {
    return join(this.getSessionDir(sessionId), 'session.lock');
  }

  private async readSession(sessionId: string): Promise<StoredSessionState> {
    const contents = await readFile(this.getSessionPath(sessionId), 'utf8');

    return JSON.parse(contents) as StoredSessionState;
  }

  private async writeSession(sessionId: string, session: StoredSessionState): Promise<void> {
    const sessionDir = this.getSessionDir(sessionId);
    const sessionPath = this.getSessionPath(sessionId);
    const tempPath = join(sessionDir, `${sessionId}.tmp-${process.pid}-${Date.now()}`);

    await mkdir(sessionDir, { recursive: true });
    await writeFile(tempPath, `${JSON.stringify(session, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'w',
    });
    await rename(tempPath, sessionPath);
  }

  private async withSessionLock<T>(sessionId: string, run: () => Promise<T>): Promise<T> {
    const sessionDir = this.getSessionDir(sessionId);
    const lockPath = this.getLockPath(sessionId);

    await mkdir(sessionDir, { recursive: true });

    while (true) {
      try {
        const handle = await open(lockPath, 'wx');

        try {
          await handle.writeFile(
            `${JSON.stringify({ createdAt: Date.now(), pid: process.pid } satisfies SessionLockContents)}\n`,
            {
              encoding: 'utf8',
            },
          );

          return await run();
        } finally {
          await handle.close();
          await rm(lockPath, { force: true });
        }
      } catch (error: unknown) {
        if (!isErrnoCode(error, 'EEXIST')) {
          throw error;
        }

        if (await this.reclaimStaleLock(lockPath)) {
          continue;
        }

        await delay(LOCK_RETRY_MS);
      }
    }
  }

  private async reclaimStaleLock(lockPath: string): Promise<boolean> {
    try {
      const contents = await readFile(lockPath, 'utf8');
      const parsed = JSON.parse(contents) as Partial<SessionLockContents>;

      if (typeof parsed.pid !== 'number' || Number.isNaN(parsed.pid)) {
        return this.reclaimUnparseableLock(lockPath);
      }

      if (isProcessRunning(parsed.pid)) {
        return false;
      }

      await rm(lockPath, { force: true });
      return true;
    } catch (error: unknown) {
      if (isErrnoCode(error, 'ENOENT')) {
        return true;
      }

      return this.reclaimUnparseableLock(lockPath);
    }
  }

  private async reclaimUnparseableLock(lockPath: string): Promise<boolean> {
    try {
      const lockStat = await stat(lockPath);

      if (Date.now() - lockStat.mtimeMs < LOCK_STARTUP_GRACE_MS) {
        return false;
      }

      await rm(lockPath, { force: true });
      return true;
    } catch (error: unknown) {
      if (isErrnoCode(error, 'ENOENT')) {
        return true;
      }

      return false;
    }
  }
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: unknown) {
    return !(error instanceof Error && 'code' in error && error.code === 'ESRCH');
  }
}
