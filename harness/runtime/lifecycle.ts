type Disposable = {
  dispose(): Promise<void> | void;
};

export class RuntimeWorkTracker {
  private readonly backgroundTasks = new Set<Promise<void>>();
  private readonly disposables: Disposable[] = [];
  private disposed = false;

  addDisposable(disposable: Disposable): void {
    this.disposables.push(disposable);
  }

  async dispose(): Promise<void> {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    await Promise.allSettled(this.backgroundTasks);

    const disposables = [...this.disposables].reverse();

    for (const disposable of disposables) {
      await disposable.dispose();
    }
  }

  track<T>(task: Promise<T>): Promise<T> {
    const normalized = Promise.resolve(task).then(
      () => {},
      () => {},
    );
    this.backgroundTasks.add(normalized);
    void normalized.finally(() => {
      this.backgroundTasks.delete(normalized);
    });
    return task;
  }
}
