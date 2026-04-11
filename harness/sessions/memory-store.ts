import { createEmptyModelUsage } from '../src/models/types.js';
import type { SessionStore } from '../src/sessions/store.js';
import type { Message, SessionState, StoredSessionState } from '../src/sessions/types.js';

function cloneMessage<T extends Message>(message: T): T {
  return structuredClone(message);
}

export class MemorySessionStore implements SessionStore {
  private readonly messages = new Map<string, Message[]>();
  private readonly sessions = new Map<
    string,
    { contextSize: number; createdAt: string; id: string; usage: ReturnType<typeof createEmptyModelUsage> }
  >();

  async appendMessage(sessionId: string, message: Message): Promise<void> {
    const messages = this.messages.get(sessionId) ?? [];

    messages.push(cloneMessage(message));
    this.messages.set(sessionId, messages);
  }

  async createSession(session: SessionState): Promise<StoredSessionState> {
    const existingSession = this.sessions.get(session.id);

    if (existingSession) {
      return {
        ...existingSession,
        messages: await this.listMessages(session.id),
      };
    }

    this.sessions.set(session.id, {
      contextSize: 0,
      id: session.id,
      createdAt: session.createdAt,
      usage: createEmptyModelUsage(),
    });
    this.messages.set(session.id, []);

    return {
      contextSize: 0,
      id: session.id,
      createdAt: session.createdAt,
      messages: [],
      usage: createEmptyModelUsage(),
    };
  }

  async getSession(sessionId: string): Promise<StoredSessionState | null> {
    const session = this.sessions.get(sessionId);

    if (!session) {
      return null;
    }

    return {
      ...session,
      messages: await this.listMessages(sessionId),
    };
  }

  async listMessages(sessionId: string): Promise<Message[]> {
    return (this.messages.get(sessionId) ?? []).map((message) => cloneMessage(message));
  }

  async writeState(sessionId: string, state: Omit<StoredSessionState, 'messages'>): Promise<void> {
    this.sessions.set(sessionId, {
      contextSize: state.contextSize,
      createdAt: state.createdAt,
      id: state.id,
      usage: structuredClone(state.usage),
    });
  }
}
