import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { SessionStore } from './store.js';
import type { Message, Session, SessionStatePatch } from './types.js';
import { applySessionStatePatch, assertValidSessionId } from './utils.js';

export type FilesystemSessionStoreOptions = {
  rootDir?: string;
};

type SessionMetadata = Omit<Session, 'messages'>;

function isErrnoCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}

export class FilesystemSessionStore implements SessionStore {
  private readonly rootDir: string;

  constructor(options: FilesystemSessionStoreOptions = {}) {
    this.rootDir = options.rootDir ?? join(process.cwd(), 'tmp', 'sessions');
  }

  async appendMessage(sessionId: string, message: Message): Promise<void> {
    await mkdir(this.getSessionDir(sessionId), { recursive: true });
    await appendFile(this.getMessagesPath(sessionId), `${JSON.stringify(message)}\n`, 'utf8');
  }

  async createSession(session: Session): Promise<Session> {
    const existingSession = await this.getSession(session.id);

    if (existingSession) {
      return existingSession;
    }

    const sessionDir = this.getSessionDir(session.id);
    const sessionPath = this.getSessionPath(session.id);
    const messagesPath = this.getMessagesPath(session.id);

    await mkdir(sessionDir, { recursive: true });

    try {
      await writeFile(sessionPath, `${JSON.stringify(this.toSessionMetadata(session), null, 2)}\n`, {
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

    try {
      await writeFile(messagesPath, '', {
        encoding: 'utf8',
        flag: 'wx',
      });
    } catch (error: unknown) {
      if (!isErrnoCode(error, 'EEXIST')) {
        throw error;
      }
    }

    return {
      ...session,
      messages: await this.listMessages(session.id),
    };
  }

  async getSession(sessionId: string): Promise<Session | null> {
    try {
      const contents = await readFile(this.getSessionPath(sessionId), 'utf8');
      const session = JSON.parse(contents) as SessionMetadata;

      return {
        ...session,
        messages: await this.listMessages(sessionId),
      };
    } catch (error: unknown) {
      if (isErrnoCode(error, 'ENOENT')) {
        return null;
      }

      throw error;
    }
  }

  async listMessages(sessionId: string): Promise<Message[]> {
    try {
      const contents = await readFile(this.getMessagesPath(sessionId), 'utf8');
      const lines = contents.split('\n').filter(Boolean);

      return lines.flatMap((line) => {
        try {
          return [JSON.parse(line) as Message];
        } catch {
          return [];
        }
      });
    } catch (error: unknown) {
      if (isErrnoCode(error, 'ENOENT')) {
        return [];
      }

      throw error;
    }
  }

  async updateSessionState(sessionId: string, patch: SessionStatePatch): Promise<void> {
    const session = await this.getSession(sessionId);

    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    applySessionStatePatch(session, patch);
    await writeFile(
      this.getSessionPath(sessionId),
      `${JSON.stringify(this.toSessionMetadata(session), null, 2)}\n`,
      'utf8',
    );
  }

  private getMessagesPath(sessionId: string): string {
    return join(this.getSessionDir(sessionId), 'messages.jsonl');
  }

  private getSessionDir(sessionId: string): string {
    assertValidSessionId(sessionId);
    return join(this.rootDir, sessionId);
  }

  private getSessionPath(sessionId: string): string {
    return join(this.getSessionDir(sessionId), 'session.json');
  }

  private toSessionMetadata(session: Session): SessionMetadata {
    return {
      createdAt: session.createdAt,
      currentTurnId: session.currentTurnId,
      id: session.id,
      pendingApproval: session.pendingApproval,
      turnStatus: session.turnStatus,
    };
  }
}
