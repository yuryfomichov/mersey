import { createEmptyModelUsage } from '../runtime/models/types.js';
import type { SessionStore } from '../runtime/sessions/store.js';
import type { Message, SessionState, StoredSessionState } from '../runtime/sessions/types.js';
import { SessionTurnLockMap } from './exclusive.js';
import { cloneStoredSession, commitSessionTurn } from './store-state.js';

export class MemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, StoredSessionState>();
  private readonly turnLocks = new SessionTurnLockMap();

  async commitTurn(sessionId: string, turnMessages: readonly Message[]): Promise<StoredSessionState> {
    const turnSnapshot = turnMessages.map((message) => structuredClone(message));

    return this.runExclusive(sessionId, async () => this.commitTurnUnlocked(sessionId, turnSnapshot));
  }

  async commitTurnExclusive(sessionId: string, turnMessages: readonly Message[]): Promise<StoredSessionState> {
    const turnSnapshot = turnMessages.map((message) => structuredClone(message));

    return this.commitTurnUnlocked(sessionId, turnSnapshot);
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

  private async commitTurnUnlocked(sessionId: string, turnMessages: readonly Message[]): Promise<StoredSessionState> {
    const existingSession = this.sessions.get(sessionId);

    if (!existingSession) {
      throw new Error(`Session does not exist: ${sessionId}`);
    }

    const committedSession = commitSessionTurn(existingSession, turnMessages);
    this.sessions.set(sessionId, committedSession);
    return cloneStoredSession(committedSession);
  }
}
