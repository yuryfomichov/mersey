export type AsyncQueue<T> = {
  end(): void;
  fail(error: unknown): void;
  iterable: AsyncIterable<T> & AsyncIterator<T>;
  push(value: T): void;
};

export function createAsyncQueue<T>(): AsyncQueue<T> {
  const values: IteratorResult<T>[] = [];
  const waiters: Array<{
    reject(error: unknown): void;
    resolve(result: IteratorResult<T>): void;
  }> = [];
  let done = false;
  let failure: unknown;
  let hasFailure = false;

  const close = (result: IteratorResult<T>): void => {
    const pendingWaiters = waiters.splice(0, waiters.length);

    for (const waiter of pendingWaiters) {
      waiter.resolve(result);
    }
  };

  return {
    end(): void {
      if (done || hasFailure) {
        return;
      }

      done = true;
      close({ done: true, value: undefined });
    },

    fail(error: unknown): void {
      if (done || hasFailure) {
        return;
      }

      hasFailure = true;
      failure = error;

      const pendingWaiters = waiters.splice(0, waiters.length);

      for (const waiter of pendingWaiters) {
        waiter.reject(error);
      }
    },

    iterable: {
      [Symbol.asyncIterator](): AsyncIterator<T> {
        return this;
      },

      next(): Promise<IteratorResult<T>> {
        const nextValue = values.shift();

        if (nextValue) {
          return Promise.resolve(nextValue);
        }

        if (hasFailure) {
          return Promise.reject(failure);
        }

        if (done) {
          return Promise.resolve({ done: true, value: undefined });
        }

        return new Promise((resolve, reject) => {
          waiters.push({ reject, resolve });
        });
      },

      return(): Promise<IteratorResult<T>> {
        done = true;
        values.length = 0;
        close({ done: true, value: undefined });

        return Promise.resolve({ done: true, value: undefined });
      },
    },

    push(value: T): void {
      if (done || hasFailure) {
        return;
      }

      const waiter = waiters.shift();

      if (waiter) {
        waiter.resolve({ done: false, value });
        return;
      }

      values.push({ done: false, value });
    },
  };
}
