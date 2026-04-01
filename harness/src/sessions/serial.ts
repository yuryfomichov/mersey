export function createTurnLock() {
  let queue: Promise<void> = Promise.resolve();
  let _release: () => void = () => {};

  return {
    async wait(): Promise<void> {
      await queue;
    },
    release(): void {
      _release();
      queue = new Promise((resolve) => {
        _release = resolve;
      });
    },
  };
}
