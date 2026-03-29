import type { SessionStore } from './store.js';
import type { Message, Session } from './types.js';

export class MemorySessionStore implements SessionStore {
  private readonly messages = new Map<string, Message[]>();
  private readonly sessions = new Map<string, Session>();

  async appendMessage(sessionId: string, message: Message): Promise<void> {
    const messages = this.messages.get(sessionId) ?? [];

    messages.push({ ...message });
    this.messages.set(sessionId, messages);
  }

  async createSession(session: Session): Promise<Session> {
    const existingSession = this.sessions.get(session.id);

    if (existingSession) {
      return {
        ...existingSession,
        messages: await this.listMessages(session.id),
      };
    }

    this.sessions.set(session.id, {
      ...session,
      messages: [],
    });
    this.messages.set(session.id, []);

    return {
      ...session,
      messages: [],
    };
  }

  async getSession(sessionId: string): Promise<Session | null> {
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
    return (this.messages.get(sessionId) ?? []).map((message) => ({ ...message }));
  }
}
