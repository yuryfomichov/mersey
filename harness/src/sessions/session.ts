import type { Message, SessionState } from './types.js';
import type { SessionStore } from './store.js';
import { freezeDeep } from '../utils/object.js';

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

function freezeMessageSnapshot<T extends Message>(message: T): T {
  return freezeDeep(cloneMessage(message));
}

function freezeStateSnapshot(state: SessionState): SessionState {
  return freezeDeep(cloneState(state));
}

export type SessionOptions = {
  createdAt?: string;
  id: string;
  store: SessionStore;
};

export class Session {
  private readonly store: SessionStore;
  private stateValue: SessionState;
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
    return this.stateValue.messages.map((message) => freezeMessageSnapshot(message));
  }

  get state(): SessionState {
    return freezeStateSnapshot(this.stateValue);
  }

  async commit(messages: Message[]): Promise<void> {
    if (messages.length === 0) {
      return;
    }

    await this.ensure();

    for (const message of messages) {
      await this.store.appendMessage(this.id, message);
      this.stateValue.messages.push(cloneMessage(message));
    }
  }

  async ensure(): Promise<void> {
    if (this.initialized) {
      return this.initialized;
    }

    this.initialized = (async () => {
      try {
        const existingSession = await this.store.getSession(this.id);
        const resolvedSession = existingSession ?? (await this.store.createSession(this.state));

        this.stateValue = cloneState(resolvedSession);
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
}
