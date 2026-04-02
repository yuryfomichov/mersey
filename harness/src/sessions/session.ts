import type { PendingApproval } from '../approvals/types.js';
import { snapshot } from '../utils/object.js';
import type { SessionStore } from './store.js';
import type { Message, SessionState, TurnStatus } from './types.js';

function normalizeState(state: SessionState): SessionState {
  return {
    ...state,
    pendingApproval: state.pendingApproval ?? null,
    turnStatus: state.turnStatus ?? 'idle',
  };
}

function cloneMessage<T extends Message>(message: T): T {
  return structuredClone(message);
}

function cloneState(state: SessionState): SessionState {
  const normalizedState = normalizeState(state);

  return {
    createdAt: normalizedState.createdAt,
    id: normalizedState.id,
    messages: normalizedState.messages.map((message) => cloneMessage(message)),
    pendingApproval: structuredClone(normalizedState.pendingApproval),
    turnStatus: normalizedState.turnStatus,
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
      pendingApproval: null,
      turnStatus: 'idle',
    };
  }

  get createdAt(): string {
    return this.stateValue.createdAt;
  }

  get id(): string {
    return this.stateValue.id;
  }

  get pendingApproval(): PendingApproval | null {
    return this.state.pendingApproval;
  }

  get turnStatus(): TurnStatus {
    return this.state.turnStatus;
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
    }

    this.invalidateSnapshots();
  }

  async applyTurn(messages: Message[], pendingApproval: PendingApproval | null): Promise<void> {
    await this.ensure();

    for (const message of messages) {
      this.stateValue.messages.push(cloneMessage(message));
    }

    this.stateValue.pendingApproval = structuredClone(pendingApproval);
    this.stateValue.turnStatus = pendingApproval ? 'awaiting_approval' : 'idle';
    await this.store.updateSession(this.stateValue);
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

        this.stateValue = cloneState(normalizeState(resolvedSession));
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

  async setPendingApproval(pendingApproval: PendingApproval): Promise<void> {
    await this.ensure();
    this.stateValue.pendingApproval = structuredClone(pendingApproval);
    this.stateValue.turnStatus = 'awaiting_approval';
    await this.store.updateSession(this.stateValue);
    this.invalidateSnapshots();
  }

  async clearPendingApproval(): Promise<void> {
    await this.ensure();

    if (!this.stateValue.pendingApproval && this.stateValue.turnStatus === 'idle') {
      return;
    }

    this.stateValue.pendingApproval = null;
    this.stateValue.turnStatus = 'idle';
    await this.store.updateSession(this.stateValue);
    this.invalidateSnapshots();
  }

  private invalidateSnapshots(): void {
    this.messagesSnapshot = null;
    this.stateSnapshot = null;
  }
}
