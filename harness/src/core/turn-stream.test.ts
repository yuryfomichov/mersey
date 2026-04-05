import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import { HarnessObserver } from '../events/observer.js';
import type { ModelProvider } from '../models/provider.js';
import { createEmptyModelUsage } from '../models/types.js';
import { FakeProvider } from '../providers/fake.js';
import { MemorySessionStore } from '../sessions/memory-store.js';
import { Session } from '../sessions/session.js';
import type { SessionStore } from '../sessions/store.js';
import { createToolRuntimeFactory } from '../tools/runtime/index.js';
import type { Tool } from '../tools/types.js';
import { createTurnStreamFactory } from './turn-stream.js';

function createTestSession(
  sessionStore: SessionStore = new MemorySessionStore(),
  sessionId = 'local-session',
): Session {
  return new Session({
    id: sessionId,
    store: sessionStore,
  });
}

async function collectChunks<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const chunks: T[] = [];

  for await (const chunk of iterable) {
    chunks.push(chunk);
  }

  return chunks;
}

function createStreamTurnFactory(input: {
  provider?: FakeProvider;
  sessionId?: string;
  sessionStore?: MemorySessionStore;
  tools?: Tool[];
}) {
  const provider = input.provider ?? new FakeProvider();
  const session = createTestSession(input.sessionStore ?? new MemorySessionStore(), input.sessionId ?? 'local-session');
  const observer = new HarnessObserver({
    getSessionId: () => session.id,
    logger: undefined,
    providerName: provider.name,
  });

  return {
    provider,
    session,
    streamTurn: createTurnStreamFactory({
      observer,
      plugins: [],
      provider,
      session,
      toolRuntimeFactory: createToolRuntimeFactory({
        policy: { workspaceRoot: process.cwd() },
        tools: input.tools ?? [],
      }),
    }),
  };
}

test('createTurnStreamFactory starts on first pull and ignores pre-consumption return', async () => {
  const { provider, streamTurn } = createStreamTurnFactory({});

  const abandonedIterator = streamTurn('abandoned', false)[Symbol.asyncIterator]();

  assert.equal(provider.requests.length, 0);
  await abandonedIterator.return?.();
  assert.equal(provider.requests.length, 0);

  const iterator = streamTurn('hello', false)[Symbol.asyncIterator]();

  assert.equal(provider.requests.length, 0);

  const firstChunk = await iterator.next();

  assert.equal(provider.requests.length, 1);
  assert.equal(firstChunk.done, false);
  assert.equal(firstChunk.value.type, 'final_message');
  assert.deepEqual(firstChunk.value, {
    message: {
      content: 'reply:hello',
      createdAt: firstChunk.value.type === 'final_message' ? firstChunk.value.message.createdAt : '',
      role: 'assistant',
      toolCalls: undefined,
      usage: createEmptyModelUsage(),
    },
    type: 'final_message',
  });
});

test('createTurnStreamFactory rejects iteration when the background turn throws undefined', async () => {
  const session = createTestSession(new MemorySessionStore());
  const provider: ModelProvider = {
    model: 'broken-model',
    name: 'broken-provider',
    async *generate() {
      yield* [];
      throw undefined;
    },
  };
  const streamTurn = createTurnStreamFactory({
    observer: new HarnessObserver({
      getSessionId: () => session.id,
      logger: undefined,
      providerName: provider.name,
    }),
    plugins: [],
    provider,
    session,
    toolRuntimeFactory: createToolRuntimeFactory({ policy: { workspaceRoot: process.cwd() }, tools: [] }),
  });

  await assert.rejects(
    async () => {
      for await (const _chunk of streamTurn('hello', false)) {
        // No-op.
      }
    },
    (error) => error === undefined,
  );
});

test('createTurnStreamFactory return aborts an active turn, drops partial history, and frees the queue', async () => {
  const sessionStore = new MemorySessionStore();
  const { session, streamTurn } = createStreamTurnFactory({
    provider: new FakeProvider({
      streamReply: async function* (input) {
        if (input.messages.at(-1)?.role === 'user' && input.messages.at(-1)?.content === 'second') {
          yield {
            response: { text: 'reply:second', usage: createEmptyModelUsage() },
            type: 'response_completed',
          };
          return;
        }

        yield { delta: 'partial', type: 'text_delta' };

        await new Promise((_, reject) => {
          input.signal?.addEventListener(
            'abort',
            () => {
              reject(input.signal?.reason);
            },
            { once: true },
          );
        });
      },
    }),
    sessionId: 'cancelled-stream-session',
    sessionStore,
  });

  const iterator = streamTurn('first', true)[Symbol.asyncIterator]();
  const firstChunk = await iterator.next();

  assert.equal(firstChunk.done, false);
  assert.equal(firstChunk.value.type, 'assistant_delta');

  await iterator.return?.();

  assert.equal(session.messages.length, 0);
  assert.equal((await sessionStore.listMessages('cancelled-stream-session')).length, 0);

  const reply = await Promise.race([
    collectChunks(streamTurn('second', true)).then((chunks) => chunks.at(-1)),
    delay(1_000).then(() => {
      throw new Error('second turn stayed blocked after stream cancellation');
    }),
  ]);

  assert.equal(reply?.type, 'final_message');
  assert.equal(reply && reply.type === 'final_message' ? reply.message.content : undefined, 'reply:second');
  assert.deepEqual(
    session.messages.map((message) => ({ content: message.content, role: message.role })),
    [
      { content: 'second', role: 'user' },
      { content: 'reply:second', role: 'assistant' },
    ],
  );
});

test('createTurnStreamFactory return waits for abort cleanup', async () => {
  let markAbortCleanupStarted!: () => void;
  let finishAbortCleanup!: () => void;

  const abortCleanupStartedPromise = new Promise<void>((resolve) => {
    markAbortCleanupStarted = resolve;
  });
  const abortCleanupFinishedPromise = new Promise<void>((resolve) => {
    finishAbortCleanup = resolve;
  });

  const { streamTurn } = createStreamTurnFactory({
    provider: new FakeProvider({
      streamReply: async function* (input) {
        yield { delta: 'partial', type: 'text_delta' };

        await new Promise((_, reject) => {
          input.signal?.addEventListener(
            'abort',
            () => {
              markAbortCleanupStarted();

              void (async () => {
                await abortCleanupFinishedPromise;
                reject(input.signal?.reason);
              })();
            },
            { once: true },
          );
        });
      },
    }),
  });

  const iterator = streamTurn('first', true)[Symbol.asyncIterator]();

  await iterator.next();

  let returnResolved = false;
  const returnPromise = iterator.return?.().then((result) => {
    returnResolved = true;
    return result;
  });

  await abortCleanupStartedPromise;
  await delay(0);
  assert.equal(returnResolved, false);

  finishAbortCleanup();

  const result = await returnPromise;

  assert.equal(returnResolved, true);
  assert.equal(result?.done, true);
});

test('createTurnStreamFactory yields only final_message when streaming is disabled', async () => {
  const { streamTurn } = createStreamTurnFactory({
    provider: new FakeProvider({
      reply: 'hello',
      streamReply: [
        { delta: 'hel', type: 'text_delta' },
        { delta: 'lo', type: 'text_delta' },
        {
          response: { text: 'hello', usage: createEmptyModelUsage() },
          type: 'response_completed',
        },
      ],
    }),
  });

  const chunks = await collectChunks(streamTurn('hello', false));

  assert.deepEqual(chunks, [
    {
      message: {
        content: 'hello',
        createdAt: chunks[0]?.type === 'final_message' ? chunks[0].message.createdAt : '',
        role: 'assistant',
        toolCalls: undefined,
        usage: createEmptyModelUsage(),
      },
      type: 'final_message',
    },
  ]);
});

test('createTurnStreamFactory snapshots final_message chunks before exposing them', async () => {
  const { session, streamTurn } = createStreamTurnFactory({
    provider: new FakeProvider({
      streamReply: [
        { delta: 'hel', type: 'text_delta' },
        { delta: 'lo', type: 'text_delta' },
        {
          response: { text: 'hello', usage: createEmptyModelUsage() },
          type: 'response_completed',
        },
      ],
    }),
  });
  const iterator = streamTurn('hello', true)[Symbol.asyncIterator]();

  const firstChunk = await iterator.next();
  const secondChunk = await iterator.next();
  const finalChunkState = await iterator.next();

  assert.equal(firstChunk.value?.type, 'assistant_delta');
  assert.equal(secondChunk.value?.type, 'assistant_delta');
  assert.equal(finalChunkState.value?.type, 'final_message');

  if (finalChunkState.value?.type !== 'final_message') {
    throw new Error('Expected a final_message chunk.');
  }

  assert.throws(() => {
    finalChunkState.value.message.content = 'mutated';
  });

  const finalState = await iterator.next();

  assert.equal(finalState.done, true);
  assert.deepEqual(
    session.messages.map((message) => ({ content: message.content, role: message.role })),
    [
      { content: 'hello', role: 'user' },
      { content: 'hello', role: 'assistant' },
    ],
  );
});
