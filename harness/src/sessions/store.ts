import type { Message, SessionState } from './types.js';

export interface SessionStore {
  appendMessage(sessionId: string, message: Message): Promise<void>;
  createSession(session: SessionState): Promise<SessionState>;
  getSession(sessionId: string): Promise<SessionState | null>;
  listMessages(sessionId: string): Promise<Message[]>;
  updateSession(session: SessionState): Promise<SessionState>;
}
