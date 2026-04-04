import type { ModelUsage } from '../models/types.js';
import type { SessionStore } from './store.js';
import type { AssistantMessage, Message, SessionState } from './types.js';

function cloneMessage<T extends Message>(message: T): T {
  return structuredClone(message);
}

const ZERO_USAGE: ModelUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cachedTokens: 0,
};

export class MemorySessionStore implements SessionStore {
  private readonly messages = new Map<string, Message[]>();
  private readonly sessions = new Map<string, { id: string; createdAt: string }>();
  private readonly usages = new Map<string, ModelUsage>();
  private readonly contextSizes = new Map<string, number>();

  async appendMessage(sessionId: string, message: Message): Promise<void> {
    const messages = this.messages.get(sessionId) ?? [];

    messages.push(cloneMessage(message));
    this.messages.set(sessionId, messages);

    if (message.role === 'assistant') {
      const assistantMessage = message as AssistantMessage;
      const currentUsage = this.usages.get(sessionId) ?? { ...ZERO_USAGE };

      if (assistantMessage.usage) {
        currentUsage.inputTokens += assistantMessage.usage.inputTokens;
        currentUsage.outputTokens += assistantMessage.usage.outputTokens;
        currentUsage.cachedTokens += assistantMessage.usage.cachedTokens;
      }

      this.usages.set(sessionId, currentUsage);

      if (assistantMessage.usage) {
        this.contextSizes.set(sessionId, assistantMessage.usage.inputTokens + assistantMessage.usage.outputTokens);
      }
    }
  }

  async createSession(session: SessionState): Promise<SessionState> {
    const existingSession = this.sessions.get(session.id);

    if (existingSession) {
      return {
        ...existingSession,
        messages: await this.listMessages(session.id),
      };
    }

    this.sessions.set(session.id, {
      id: session.id,
      createdAt: session.createdAt,
    });
    this.messages.set(session.id, []);
    this.usages.set(session.id, { ...ZERO_USAGE });
    this.contextSizes.set(session.id, 0);

    return {
      id: session.id,
      createdAt: session.createdAt,
      messages: [],
    };
  }

  async getSession(sessionId: string): Promise<SessionState | null> {
    const session = this.sessions.get(sessionId);

    if (!session) {
      return null;
    }

    return {
      ...session,
      messages: await this.listMessages(sessionId),
    };
  }

  async getUsage(sessionId: string): Promise<ModelUsage> {
    return this.usages.get(sessionId) ?? { ...ZERO_USAGE };
  }

  async getContextSize(sessionId: string): Promise<number> {
    return this.contextSizes.get(sessionId) ?? 0;
  }

  async listMessages(sessionId: string): Promise<Message[]> {
    return (this.messages.get(sessionId) ?? []).map((message) => cloneMessage(message));
  }
}
