import { createEmptyModelUsage } from '../runtime/models/types.js';
import type { SessionStore } from '../runtime/sessions/store.js';
import type { Message, SessionState, StoredSessionState } from '../runtime/sessions/types.js';
import { SessionTurnLockMap } from './exclusive.js';

function cloneMessage<T extends Message>(message: T): T {
  return structuredClone(message);
}

function cloneStoredSession(session: StoredSessionState): StoredSessionState {
  return {
    contextSize: session.contextSize,
    createdAt: session.createdAt,
    id: session.id,
    messages: session.messages.map((message) => cloneMessage(message)),
    usage: structuredClone(session.usage),
  };
}

export class MemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, StoredSessionState>();
  private readonly turnLocks = new SessionTurnLockMap();

  async commitTurn(
    sessionId: string,
    turnMessages: readonly Message[],
    state: Omit<StoredSessionState, 'messages'>,
  ): Promise<void> {
    const existingSession = this.sessions.get(sessionId);

    if (!existingSession) {
      throw new Error(`Session does not exist: ${sessionId}`);
    }

    this.sessions.set(sessionId, {
      contextSize: state.contextSize,
      createdAt: state.createdAt,
      id: state.id,
      messages: [
        ...existingSession.messages.map((message) => cloneMessage(message)),
        ...turnMessages.map(cloneMessage),
      ],
      usage: structuredClone(state.usage),
    });
  }

  async createSession(session: SessionState): Promise<StoredSessionState> {
    const existingSession = this.sessions.get(session.id);

    if (existingSession) {
      return cloneStoredSession(existingSession);
    }

    const storedSession: StoredSessionState = {
      contextSize: 0,
      createdAt: session.createdAt,
      id: session.id,
      messages: [],
      usage: createEmptyModelUsage(),
    };

    this.sessions.set(session.id, storedSession);
    return cloneStoredSession(storedSession);
  }

  async getSession(sessionId: string): Promise<StoredSessionState | null> {
    const session = this.sessions.get(sessionId);

    return session ? cloneStoredSession(session) : null;
  }

  async runExclusive<T>(sessionId: string, run: () => Promise<T>): Promise<T> {
    return this.turnLocks.runExclusive(sessionId, run);
  }
}
