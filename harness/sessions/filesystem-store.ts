import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { createEmptyModelUsage } from '../src/models/types.js';
import type { SessionStore } from '../src/sessions/store.js';
import type { Message, SessionState, StoredSessionState } from '../src/sessions/types.js';
import { assertValidSessionId } from './utils.js';

export type FilesystemSessionStoreOptions = {
  rootDir?: string;
};

type SessionMetadata = Omit<StoredSessionState, 'messages'>;

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

  async createSession(session: SessionState): Promise<StoredSessionState> {
    const existingSession = await this.getSession(session.id);

    if (existingSession) {
      return existingSession;
    }

    const sessionDir = this.getSessionDir(session.id);
    const sessionPath = this.getSessionPath(session.id);
    const messagesPath = this.getMessagesPath(session.id);

    await mkdir(sessionDir, { recursive: true });

    const metadata: SessionMetadata = {
      contextSize: 0,
      id: session.id,
      createdAt: session.createdAt,
      usage: createEmptyModelUsage(),
    };

    try {
      await writeFile(sessionPath, `${JSON.stringify(metadata, null, 2)}\n`, {
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
      contextSize: 0,
      id: session.id,
      createdAt: session.createdAt,
      messages: [],
      usage: createEmptyModelUsage(),
    };
  }

  async getSession(sessionId: string): Promise<StoredSessionState | null> {
    try {
      const metadata = await this.readMetadata(sessionId);

      return {
        contextSize: metadata.contextSize,
        id: metadata.id,
        createdAt: metadata.createdAt,
        messages: await this.listMessages(sessionId),
        usage: metadata.usage,
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

  private async readMetadata(sessionId: string): Promise<SessionMetadata> {
    const contents = await readFile(this.getSessionPath(sessionId), 'utf8');
    return JSON.parse(contents) as SessionMetadata;
  }

  private async writeMetadata(sessionId: string, metadata: SessionMetadata): Promise<void> {
    await writeFile(this.getSessionPath(sessionId), `${JSON.stringify(metadata, null, 2)}\n`, {
      encoding: 'utf8',
    });
  }

  async writeState(sessionId: string, state: Omit<StoredSessionState, 'messages'>): Promise<void> {
    await this.writeMetadata(sessionId, state);
  }
}
