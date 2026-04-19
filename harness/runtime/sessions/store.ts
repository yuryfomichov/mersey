import type { Message, SessionState, StoredSessionState } from './types.js';

export interface SessionStore {
  commitTurn(sessionId: string, turnMessages: readonly Message[]): Promise<StoredSessionState>;

  /**
   * Commit a turn while the caller already holds the per-session exclusive lock.
   *
   * Callers must only invoke this inside `runExclusive(sessionId, ...)` for the
   * same `sessionId`. Calling it without that lock can lose concurrent updates.
   * If the caller does not already hold the lock, use `commitTurn()` instead.
   */
  commitTurnExclusive(sessionId: string, turnMessages: readonly Message[]): Promise<StoredSessionState>;
  createSession(session: SessionState): Promise<StoredSessionState>;
  getSession(sessionId: string): Promise<StoredSessionState | null>;

  /**
   * Run work while holding the per-session exclusive lock for `sessionId`.
   */
  runExclusive<T>(sessionId: string, run: () => Promise<T>): Promise<T>;
}
