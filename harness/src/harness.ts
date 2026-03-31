import type { HarnessEvent, HarnessEventListener } from './events/index.js';
import { emitRuntimeTrace, type HarnessLogger } from './logger/index.js';
import { runLoop } from './loop.js';
import type { ModelProvider } from './models/index.js';
import { createProvider, type ProviderDefinition } from './providers/index.js';
import { MemorySessionStore, type Message, type Session, type SessionStore } from './sessions/index.js';
import type { Tool, ToolPolicy } from './tools/index.js';

export type Harness = {
  session: Session;
  sendUserMessage(content: string): Promise<Message>;
  subscribe(listener: HarnessEventListener): () => void;
};

export type CreateHarnessOptions = {
  debug?: boolean;
  loggers?: HarnessLogger[];
  providerInstance?: ModelProvider;
  provider?: ProviderDefinition;
  sessionStore?: SessionStore;
  sessionId?: string;
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

  async function enqueueSend(content: string): Promise<Message> {
    const waitForTurn = sendQueue;
    let releaseTurn!: () => void;

    sendQueue = new Promise((resolve) => {
      releaseTurn = resolve;
    });

    await waitForTurn;

    try {
      return await runLoop({
        content,
        debug: options.debug,
        emitEvent(event: HarnessEvent): void {
          const frozenEvent = deepFreeze(structuredClone(event));

          emitRuntimeTrace(runtimeLogger, 'event_emitted', {
            eventType: frozenEvent.type,
            sessionId: frozenEvent.sessionId,
            turnId: frozenEvent.turnId,
          });

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
        session,
        sessionStore,
        systemPrompt,
        toolPolicy,
        tools,
      });
    } finally {
      releaseTurn();
    }
  }

  return {
    session,
    async sendUserMessage(content: string): Promise<Message> {
      await ensureSession();
      return enqueueSend(content);
    },
    subscribe(listener: HarnessEventListener): () => void {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
  };
}
