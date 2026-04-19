import type { Message, SessionState, StoredSessionState } from './types.js';

export interface SessionStore {
  commitTurn(sessionId: string, turnMessages: readonly Message[]): Promise<StoredSessionState>;
  createSession(session: SessionState): Promise<StoredSessionState>;
  getSession(sessionId: string): Promise<StoredSessionState | null>;
  runExclusive<T>(sessionId: string, run: () => Promise<T>): Promise<T>;
}
