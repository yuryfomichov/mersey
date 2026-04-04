import type { ModelUsage } from '../models/types.js';
import type { Message, SessionState } from './types.js';

export interface SessionStore {
  appendMessage(sessionId: string, message: Message): Promise<void>;
  createSession(session: SessionState): Promise<SessionState>;
  getSession(sessionId: string): Promise<SessionState | null>;
  getUsage(sessionId: string): Promise<ModelUsage>;
  getContextSize(sessionId: string): Promise<number>;
  listMessages(sessionId: string): Promise<Message[]>;
}
