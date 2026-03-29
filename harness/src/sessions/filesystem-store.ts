import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { SessionStore } from './store.js';
import type { Message, Session } from './types.js';

export type FilesystemSessionStoreOptions = {
  rootDir?: string;
};

type SessionMetadata = Omit<Session, 'messages'>;

function assertValidSessionId(sessionId: string): void {
  if (!sessionId || sessionId === '.' || sessionId === '..') {
    throw new Error(`Invalid session id: ${sessionId}`);
  }

  if (!/^[A-Za-z0-9._-]+$/.test(sessionId)) {
    throw new Error(`Invalid session id: ${sessionId}`);
  }
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

    await mkdir(this.getSessionDir(session.id), { recursive: true });
    await writeFile(
      this.getSessionPath(session.id),
      `${JSON.stringify(this.toSessionMetadata(session), null, 2)}\n`,
      'utf8',
    );
    await writeFile(this.getMessagesPath(session.id), '', 'utf8');

    return {
      ...session,
      messages: [],
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
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        return null;
      }

      throw error;
    }
  }

  async listMessages(sessionId: string): Promise<Message[]> {
    try {
      const contents = await readFile(this.getMessagesPath(sessionId), 'utf8');
      const lines = contents.split('\n').filter(Boolean);

      return lines.map((line) => JSON.parse(line) as Message);
    } catch (error: unknown) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
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

  private toSessionMetadata(session: Session): SessionMetadata {
    return {
      createdAt: session.createdAt,
      id: session.id,
    };
  }
}
