import { createEmptyModelUsage, type ModelUsage } from '../runtime/models/types.js';
import type { HarnessSession } from '../runtime/sessions/runtime.js';
import type { SessionStore } from '../runtime/sessions/store.js';
import type { Message, SessionState, StoredSessionState } from '../runtime/sessions/types.js';
import { snapshot } from '../runtime/utils/object.js';

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

export type SessionOptions = {
  createdAt?: string;
  id: string;
  store: SessionStore;
};

export class Session implements HarnessSession {
  private readonly store: SessionStore;
  private stateValue: SessionState;
  private usageValue: ModelUsage = createEmptyModelUsage();
  private contextSizeValue = 0;
  private activeExclusiveSessionId: string | null = null;
  private messagesSnapshot: readonly Message[] | null = null;
  private stateSnapshot: SessionState | null = null;
  private initialized: Promise<void> | null = null;

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

    if (this.activeExclusiveSessionId === this.id) {
      await this.commitUnlocked(messages);
      return;
    }

    await this.runExclusive(() => this.commitUnlocked(messages));
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
    await this.ensure();

    return this.store.runExclusive(this.id, async () => {
      await this.refreshFromStore();

      const previousExclusiveSessionId = this.activeExclusiveSessionId;
      this.activeExclusiveSessionId = this.id;

      try {
        return await run();
      } finally {
        this.activeExclusiveSessionId = previousExclusiveSessionId;
      }
    });
  }

  private async commitUnlocked(messages: Message[]): Promise<void> {
    if (messages.length === 0) {
      return;
    }

    const storedState = await this.store.commitTurnExclusive(
      this.id,
      messages.map((message) => cloneMessage(message)),
    );
    this.hydrate(storedState);

    this.invalidateSnapshots();
  }

  private invalidateSnapshots(): void {
    this.messagesSnapshot = null;
    this.stateSnapshot = null;
  }
  private hydrate(state: StoredSessionState): void {
    this.stateValue = cloneState(state);
    this.usageValue = cloneUsage(state.usage);
    this.contextSizeValue = state.contextSize;
  }

  private async refreshFromStore(): Promise<void> {
    const latestSession = await this.store.getSession(this.id);

    if (!latestSession) {
      return;
    }

    this.hydrate(latestSession);
    this.invalidateSnapshots();
  }
}
