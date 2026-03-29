import type { Message, Session } from './types.js';

export interface SessionStore {
  appendMessage(sessionId: string, message: Message): Promise<void>;
  createSession(session: Session): Promise<Session>;
  getSession(sessionId: string): Promise<Session | null>;
  listMessages(sessionId: string): Promise<Message[]>;
}
