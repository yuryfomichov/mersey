type PendingTurn = Promise<void>;

export class SessionTurnLockMap {
  private readonly pendingBySessionId = new Map<string, PendingTurn>();

  async runExclusive<T>(sessionId: string, run: () => Promise<T>): Promise<T> {
    const previous = this.pendingBySessionId.get(sessionId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });

    this.pendingBySessionId.set(sessionId, current);
    await previous;

    try {
      return await run();
    } finally {
      release();

      if (this.pendingBySessionId.get(sessionId) === current) {
        this.pendingBySessionId.delete(sessionId);
      }
    }
  }
}
