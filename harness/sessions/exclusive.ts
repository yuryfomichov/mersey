import { AsyncLocalStorage } from 'node:async_hooks';

type PendingTurn = Promise<void>;
type LockToken = symbol;
type HeldSessions = Map<string, LockToken>;

export class SessionTurnLockMap {
  private readonly pendingBySessionId = new Map<string, PendingTurn>();
  private readonly activeTokens = new Set<LockToken>();
  private readonly heldSessions = new AsyncLocalStorage<HeldSessions>();

  isHeld(sessionId: string): boolean {
    const token = this.heldSessions.getStore()?.get(sessionId);
    return token !== undefined && this.activeTokens.has(token);
  }

  async runExclusive<T>(sessionId: string, run: () => Promise<T>): Promise<T> {
    if (this.isHeld(sessionId)) {
      return run();
    }

    const previous = this.pendingBySessionId.get(sessionId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });

    this.pendingBySessionId.set(sessionId, current);
    await previous;

    const token = Symbol(sessionId);
    const heldSessions = new Map(this.heldSessions.getStore());
    heldSessions.set(sessionId, token);
    this.activeTokens.add(token);

    try {
      return await this.heldSessions.run(heldSessions, run);
    } finally {
      this.activeTokens.delete(token);
      release();

      if (this.pendingBySessionId.get(sessionId) === current) {
        this.pendingBySessionId.delete(sessionId);
      }
    }
  }
}
