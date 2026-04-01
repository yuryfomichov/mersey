import { randomUUID } from 'node:crypto';

import type { HarnessEvent, HarnessEventListener } from './events/types.js';
import { createFanoutLogger } from './logger/fanout.js';
import { emitRuntimeTrace } from './logger/runtime-trace.js';
import type { HarnessLogger } from './logger/types.js';
import { streamLoop, type TurnChunk } from './loop/loop.js';
import { createAsyncQueue } from './loop/queue.js';
import type { ModelProvider } from './models/provider.js';
import { createProvider, type ProviderDefinition } from './providers/factory.js';
import { MemorySessionStore } from './sessions/memory-store.js';
import { ensureSession } from './sessions/session-init.js';
import type { Message, Session } from './sessions/types.js';
import type { SessionStore } from './sessions/store.js';
import type { Tool } from './tools/types.js';
import type { ToolPolicy } from './tools/context.js';

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

  let sendQueue: Promise<void> = Promise.resolve();

  function enqueueStream(content: string): AsyncIterable<TurnChunk> & AsyncIterator<TurnChunk> {
    const queue = createAsyncQueue<TurnChunk>();
    const abortController = new AbortController();
    let started = false;

    const start = (): void => {
      if (started) {
        return;
      }

      started = true;

      const sessionReady = ensureSession({ session, sessionStore });
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
