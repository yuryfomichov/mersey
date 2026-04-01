import { randomUUID } from 'node:crypto';

import type { HarnessEvent, HarnessEventListener } from './events/index.js';
import { emitRuntimeTrace, type HarnessLogger } from './logger/index.js';
import { streamLoop, type TurnChunk } from './loop.js';
import type { ModelProvider } from './models/index.js';
import { createProvider, type ProviderDefinition } from './providers/index.js';
import { MemorySessionStore, type Message, type Session, type SessionStore } from './sessions/index.js';
import type { Tool, ToolPolicy } from './tools/index.js';

type AsyncQueue<T> = {
  end(): void;
  fail(error: unknown): void;
  iterable: AsyncIterable<T> & AsyncIterator<T>;
  push(value: T): void;
};

function createAsyncQueue<T>(): AsyncQueue<T> {
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

export type Harness = {
  session: Session;
  sendUserMessage(content: string): Promise<Message>;
  streamUserMessage(content: string): AsyncIterable<TurnChunk>;
  subscribe(listener: HarnessEventListener): () => void;
};

export type CreateHarnessOptions = {
  debug?: boolean;
  loggers?: HarnessLogger[];
  providerInstance?: ModelProvider;
  provider?: ProviderDefinition;
  sessionStore?: SessionStore;
  sessionId?: string;
  stream?: boolean;
  systemPrompt?: string;
  toolPolicy?: ToolPolicy;
  tools?: Tool[];
};

function createFanoutLogger(loggers: HarnessLogger[] | undefined): HarnessLogger | undefined {
  if (!loggers?.length) {
    return undefined;
  }

  return {
    log(event): void {
      for (const logger of loggers) {
        try {
          const result = logger.log(event);

          if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
            void Promise.resolve(result).catch(() => {});
          }
        } catch {
          // Logger failures are best-effort and isolated.
        }
      }
    },
  };
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== 'object') {
    return value;
  }

  for (const nestedValue of Object.values(value)) {
    deepFreeze(nestedValue);
  }

  return Object.freeze(value);
}

export function createHarness(options: CreateHarnessOptions = {}): Harness {
  const provider = options.providerInstance ?? (options.provider ? createProvider(options.provider) : null);
  const runtimeLogger = createFanoutLogger(options.loggers);
  const sessionStore = options.sessionStore ?? new MemorySessionStore();
  const systemPrompt = options.systemPrompt;
  const toolPolicy = options.toolPolicy ?? { workspaceRoot: process.cwd() };
  const tools = options.tools ?? [];
  const listeners = new Set<HarnessEventListener>();

  if (!provider) {
    throw new Error('Missing provider. Pass providerInstance or provider config to createHarness().');
  }

  const resolvedProvider = provider;

  const session: Session = {
    id: options.sessionId ?? 'local-session',
    createdAt: new Date().toISOString(),
    messages: [],
  };

  emitRuntimeTrace(runtimeLogger, 'session_started', {
    debug: Boolean(options.debug),
    provider: provider.name,
    runId: randomUUID(),
    sessionId: session.id,
    stream: Boolean(options.stream),
  });

  let initializedSessionPromise: Promise<void> | null = null;
  // Queue sendUserMessage calls so one session cannot mutate its transcript concurrently.
  let sendQueue: Promise<void> = Promise.resolve();

  async function ensureSession(): Promise<void> {
    if (initializedSessionPromise) {
      return initializedSessionPromise;
    }

    initializedSessionPromise = (async () => {
      try {
        const existingSession = await sessionStore.getSession(session.id);

        if (existingSession) {
          session.createdAt = existingSession.createdAt;
          session.messages = existingSession.messages;
          return;
        }

        const createdSession = await sessionStore.createSession(session);

        session.createdAt = createdSession.createdAt;
        session.messages = createdSession.messages;
      } catch (error: unknown) {
        initializedSessionPromise = null;
        throw error;
      }
    })();

    return initializedSessionPromise;
  }

  function enqueueStream(content: string): AsyncIterable<TurnChunk> & AsyncIterator<TurnChunk> {
    const queue = createAsyncQueue<TurnChunk>();
    const abortController = new AbortController();
    let started = false;

    const start = (): void => {
      if (started) {
        return;
      }

      started = true;

      const sessionReady = ensureSession();
      const waitForTurn = sendQueue;
      let releaseTurn!: () => void;

      sendQueue = new Promise((resolve) => {
        releaseTurn = resolve;
      });

      void (async () => {
        try {
          await sessionReady;
          await waitForTurn;

          for await (const chunk of streamLoop({
            content,
            debug: options.debug,
            emitEvent(event: HarnessEvent): void {
              emitRuntimeTrace(runtimeLogger, 'event_emitted', {
                eventType: event.type,
                sessionId: event.sessionId,
                turnId: event.turnId,
              });

              if (listeners.size === 0) {
                return;
              }

              const frozenEvent = deepFreeze(structuredClone(event));

              for (const listener of listeners) {
                try {
                  const result = listener(frozenEvent);

                  if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
                    void Promise.resolve(result).catch(() => {
                      emitRuntimeTrace(runtimeLogger, 'listener_failed', {
                        eventType: frozenEvent.type,
                      });
                    });
                  }
                } catch {
                  emitRuntimeTrace(runtimeLogger, 'listener_failed', {
                    eventType: frozenEvent.type,
                  });
                }
              }
            },
            logger: runtimeLogger,
            provider: resolvedProvider,
            signal: abortController.signal,
            session,
            sessionStore,
            stream: options.stream,
            systemPrompt,
            toolPolicy,
            tools,
          })) {
            queue.push(chunk);
          }

          queue.end();
        } catch (error: unknown) {
          queue.fail(error);
        } finally {
          releaseTurn();
        }
      })();
    };

    return {
      [Symbol.asyncIterator](): AsyncIterator<TurnChunk> {
        return this;
      },
      next(): Promise<IteratorResult<TurnChunk>> {
        start();
        return queue.iterable.next();
      },
      return(): Promise<IteratorResult<TurnChunk>> {
        if (!started) {
          return Promise.resolve({ done: true, value: undefined });
        }

        abortController.abort();
        return queue.iterable.return?.() ?? Promise.resolve({ done: true, value: undefined });
      },
    };
  }

  return {
    session,
    async sendUserMessage(content: string): Promise<Message> {
      let finalMessage: Message | null = null;

      for await (const chunk of enqueueStream(content)) {
        if (chunk.type === 'final_message') {
          finalMessage = chunk.message;
        }
      }

      if (!finalMessage) {
        throw new Error('Turn completed without a final assistant message.');
      }

      return finalMessage;
    },
    streamUserMessage(content: string): AsyncIterable<TurnChunk> {
      return enqueueStream(content);
    },
    subscribe(listener: HarnessEventListener): () => void {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
  };
}
