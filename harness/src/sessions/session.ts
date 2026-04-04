import { createEmptyModelUsage, type ModelUsage } from '../models/types.js';
import { snapshot } from '../utils/object.js';
import type { SessionStore } from './store.js';
import type { Message, SessionState, StoredSessionState } from './types.js';

function cloneMessage<T extends Message>(message: T): T {
  return structuredClone(message);
}

function cloneState(state: SessionState): SessionState {
  return {
    createdAt: state.createdAt,
    id: state.id,
    messages: state.messages.map((message) => cloneMessage(message)),
  };
}

function cloneUsage(usage: ModelUsage): ModelUsage {
  return structuredClone(usage);
}

function getMessageUsage(message: Message): ModelUsage {
  return message.role === 'assistant' && message.usage ? message.usage : createEmptyModelUsage();
}

function getUsageTotalTokens(usage: ModelUsage): number {
  return usage.uncachedInputTokens + usage.cachedInputTokens + usage.cacheWriteInputTokens + usage.outputTokens;
}

function addUsage(left: ModelUsage, right: ModelUsage): ModelUsage {
  return {
    cacheWriteInputTokens: left.cacheWriteInputTokens + right.cacheWriteInputTokens,
    cachedInputTokens: left.cachedInputTokens + right.cachedInputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    uncachedInputTokens: left.uncachedInputTokens + right.uncachedInputTokens,
  };
}

export type SessionOptions = {
  createdAt?: string;
  id: string;
  store: SessionStore;
};

export class Session {
  private readonly store: SessionStore;
  private stateValue: SessionState;
  private usageValue: ModelUsage = createEmptyModelUsage();
  private contextSizeValue = 0;
  private messagesSnapshot: readonly Message[] | null = null;
  private stateSnapshot: SessionState | null = null;
  private initialized: Promise<void> | null = null;
  private turnQueue: Promise<void> = Promise.resolve();

  constructor({ createdAt, id, store }: SessionOptions) {
    this.store = store;
    this.stateValue = {
      createdAt: createdAt ?? new Date().toISOString(),
      id,
      messages: [],
    };
  }

  get createdAt(): string {
    return this.stateValue.createdAt;
  }

  get id(): string {
    return this.stateValue.id;
  }

  get messages(): readonly Message[] {
    if (!this.messagesSnapshot) {
      this.messagesSnapshot = snapshot(this.stateValue.messages);
    }

    return this.messagesSnapshot;
  }

  get state(): SessionState {
    if (!this.stateSnapshot) {
      this.stateSnapshot = snapshot(this.stateValue);
    }

    return this.stateSnapshot;
  }

  async getUsage(): Promise<ModelUsage> {
    await this.ensure();
    return cloneUsage(this.usageValue);
  }

  async getContextSize(): Promise<number> {
    await this.ensure();
    return this.contextSizeValue;
  }

  async commit(messages: Message[]): Promise<void> {
    if (messages.length === 0) {
      return;
    }

    await this.ensure();

    for (const message of messages) {
      const storedMessage = cloneMessage(message);
      const stateMessage = cloneMessage(message);

      await this.store.appendMessage(this.id, storedMessage);
      this.stateValue.messages.push(stateMessage);
      this.updateMetrics(stateMessage);
    }

    await this.store.writeState(this.id, this.getStoredState());

    this.invalidateSnapshots();
  }

  async ensure(): Promise<void> {
    if (this.initialized) {
      return this.initialized;
    }

    this.initialized = (async () => {
      try {
        const existingSession = await this.store.getSession(this.id);
        const resolvedSession = existingSession ?? (await this.store.createSession(this.state));

        this.hydrate(resolvedSession);
        this.invalidateSnapshots();
      } catch (error: unknown) {
        this.initialized = null;
        throw error;
      }
    })();

    return this.initialized;
  }

  async runExclusive<T>(run: () => Promise<T>): Promise<T> {
    const waitForTurn = this.turnQueue;
    let releaseTurn!: () => void;

    this.turnQueue = new Promise((resolve) => {
      releaseTurn = resolve;
    });

    await waitForTurn;

    try {
      return await run();
    } finally {
      releaseTurn();
    }
  }

  private invalidateSnapshots(): void {
    this.messagesSnapshot = null;
    this.stateSnapshot = null;
  }

  private getStoredState(): Omit<StoredSessionState, 'messages'> {
    return {
      contextSize: this.contextSizeValue,
      createdAt: this.createdAt,
      id: this.id,
      usage: cloneUsage(this.usageValue),
    };
  }

  private hydrate(state: StoredSessionState): void {
    this.stateValue = cloneState(state);
    this.usageValue = cloneUsage(state.usage);
    this.contextSizeValue = state.contextSize;
  }

  private updateMetrics(message: Message): void {
    const usage = getMessageUsage(message);
    this.usageValue = addUsage(this.usageValue, usage);

    if (message.role === 'assistant' && message.usage) {
      this.contextSizeValue = getUsageTotalTokens(message.usage);
    }
  }
}
