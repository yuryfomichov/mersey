import type { Message, SessionState, StoredSessionState } from './types.js';

export interface SessionStore {
  appendMessage(sessionId: string, message: Message): Promise<void>;
  createSession(session: SessionState): Promise<StoredSessionState>;
  getSession(sessionId: string): Promise<StoredSessionState | null>;
  listMessages(sessionId: string): Promise<Message[]>;
  writeState(sessionId: string, state: Omit<StoredSessionState, 'messages'>): Promise<void>;
}
