import type { Message, Session, SessionStatePatch } from './types.js';

export interface SessionStore {
  appendMessage(sessionId: string, message: Message): Promise<void>;
  createSession(session: Session): Promise<Session>;
  getSession(sessionId: string): Promise<Session | null>;
  listMessages(sessionId: string): Promise<Message[]>;
  updateSessionState(sessionId: string, patch: SessionStatePatch): Promise<void>;
}
