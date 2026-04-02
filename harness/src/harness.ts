import { createAsyncQueue } from './async-queue.js';
import { HarnessObserver } from './events/observer.js';
import type { HarnessEventListener } from './events/types.js';
import { createFanoutLogger } from './logger/fanout.js';
import type { HarnessLogger } from './logger/types.js';
import { streamLoop, type TurnChunk } from './loop/loop.js';
import { snapshotTurnChunk } from './loop/snapshot.js';
import type { ModelProvider } from './models/provider.js';
import { createProvider, type ProviderDefinition } from './providers/factory.js';
import { MemorySessionStore } from './sessions/memory-store.js';
import { Session } from './sessions/session.js';
import type { Message } from './sessions/types.js';
import type { ToolPolicy } from './tools/context.js';
import { getToolDefinitions } from './tools/runtime.js';
import type { Tool } from './tools/types.js';

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
  session?: Session;
  stream?: boolean;
  systemPrompt?: string;
  toolPolicy?: ToolPolicy;
  tools?: Tool[];
};

type TurnStreamOptions = {
  content: string;
  observer: HarnessObserver;
  provider: ModelProvider;
  session: Session;
  stream?: boolean;
  systemPrompt?: string;
  toolPolicy: ToolPolicy;
  tools: Tool[];
};

function createTurnStream({
  content,
  observer,
  provider,
  session,
  stream,
  systemPrompt,
  toolPolicy,
  tools,
}: TurnStreamOptions): AsyncIterable<TurnChunk> & AsyncIterator<TurnChunk> {
  const queue = createAsyncQueue<TurnChunk>();
  const abortController = new AbortController();
  let backgroundTask: Promise<void> | null = null;
  let started = false;

  const start = (): void => {
    if (started) {
      return;
    }

    started = true;

    backgroundTask = session.runExclusive(async () => {
      try {
        await session.ensure();

        const iterator = streamLoop({
          content,
          history: session.messages,
          observer,
          provider,
          signal: abortController.signal,
          stream,
          systemPrompt,
          toolPolicy,
          tools,
        });
        let turnMessages: Message[] = [];

        while (true) {
          const result = await iterator.next();

          if (result.done) {
            turnMessages = result.value;
            break;
          }

          queue.push(snapshotTurnChunk(result.value));
        }

        await session.commit(turnMessages);
        queue.end();
      } catch (error: unknown) {
        queue.fail(error);
        throw error;
      }
    });

    void backgroundTask.catch(() => {});
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

      return (async () => {
        await (queue.iterable.return?.() ?? Promise.resolve({ done: true, value: undefined }));
        await backgroundTask?.catch(() => {});

        return { done: true, value: undefined };
      })();
    },
  };
}

export function createHarness(options: CreateHarnessOptions = {}): Harness {
  const provider = options.providerInstance ?? (options.provider ? createProvider(options.provider) : null);
  const runtimeLogger = createFanoutLogger(options.loggers);
  const session = options.session ?? new Session({ id: 'local-session', store: new MemorySessionStore() });
  const systemPrompt = options.systemPrompt;
  const toolPolicy = options.toolPolicy ?? { workspaceRoot: process.cwd() };
  const tools = options.tools ?? [];

  if (!provider) {
    throw new Error('Missing provider. Pass providerInstance or provider config to createHarness().');
  }

  const resolvedProvider = provider;
  const toolDefinitions = getToolDefinitions(tools);
  const observer = new HarnessObserver({
    debug: options.debug,
    logger: runtimeLogger,
    providerName: resolvedProvider.name,
    sessionId: session.id,
    stream: options.stream,
  });
  observer.sessionStarted();

  return {
    session,
    async sendUserMessage(content: string): Promise<Message> {
      let finalMessage: Message | null = null;

      for await (const chunk of createTurnStream({
        content,
        observer,
        provider: resolvedProvider,
        session,
        stream: options.stream,
        systemPrompt,
        toolPolicy,
        tools,
      })) {
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
      return createTurnStream({
        content,
        observer,
        provider: resolvedProvider,
        session,
        stream: options.stream,
        systemPrompt,
        toolPolicy,
        tools,
      });
    },
    subscribe(listener: HarnessEventListener): () => void {
      return observer.subscribe(listener);
    },
  };
}
