import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import { FakeProvider } from '../../providers/fake.js';
import { MemorySessionStore, Session } from '../../sessions/index.js';
import { HarnessEventReporter } from '../events/reporter.js';
import type { ModelProvider } from '../models/provider.js';
import { createEmptyModelUsage } from '../models/types.js';
import { createPluginRunner } from '../plugins/runner.js';
import type { HarnessPlugin } from '../plugins/types.js';
import type { HarnessSession } from '../sessions/runtime.js';
import type { SessionStore } from '../sessions/store.js';
import type { Message, StoredSessionState } from '../sessions/types.js';
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

function createLiveSession(messages: Message[], sessionId = 'live-session'): HarnessSession {
  return {
    createdAt: '2024-01-01T00:00:00.000Z',
    async commit(nextMessages: Message[]) {
      messages.push(...nextMessages);
    },
    async ensure() {},
    async getContextSize() {
      return 0;
    },
    async getUsage() {
      return createEmptyModelUsage();
    },
    id: sessionId,
    get messages() {
      return messages;
    },
    async runExclusive<T>(run: () => Promise<T>): Promise<T> {
      return run();
    },
  };
}

function createStreamTurnFactory(input: {
  plugins?: HarnessPlugin[];
  provider?: FakeProvider;
  sessionId?: string;
  sessionStore?: MemorySessionStore;
  tools?: Tool[];
}) {
  const provider = input.provider ?? new FakeProvider();
  const session = createTestSession(input.sessionStore ?? new MemorySessionStore(), input.sessionId ?? 'local-session');
  const reporter = new HarnessEventReporter({
    getSessionId: () => session.id,
    providerName: provider.name,
  });

  return {
    provider,
    session,
    streamTurn: createTurnStreamFactory({
      pluginRunner: createPluginRunner({
        reporter,
        plugins: input.plugins ?? [],
        runId: reporter.getRunId(),
      }),
      reporter,
      provider,
      session,
      toolRuntimeFactory: createToolRuntimeFactory({
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

test('createTurnStreamFactory ensures the session before reading history', async () => {
  let ensured = false;
  const session: HarnessSession = {
    createdAt: '2024-01-01T00:00:00.000Z',
    async commit(_messages: Message[]) {},
    async ensure() {
      ensured = true;
    },
    async getContextSize() {
      return 0;
    },
    async getUsage() {
      return createEmptyModelUsage();
    },
    id: 'ensure-history-session',
    get messages() {
      return ensured
        ? [
            {
              content: 'persisted',
              createdAt: '2024-01-01T00:00:00.000Z',
              role: 'user' as const,
            },
          ]
        : [];
    },
    async runExclusive<T>(run: () => Promise<T>): Promise<T> {
      return run();
    },
  };
  const provider = new FakeProvider();
  const reporter = new HarnessEventReporter({
    getSessionId: () => session.id,
    providerName: provider.name,
  });
  const streamTurn = createTurnStreamFactory({
    pluginRunner: createPluginRunner({
      reporter,
      plugins: [],
      runId: reporter.getRunId(),
    }),
    reporter,
    provider,
    session,
    toolRuntimeFactory: createToolRuntimeFactory({ tools: [] }),
  });

  await collectChunks(streamTurn('hello', false));

  assert.equal(provider.requests.length, 1);
  assert.deepEqual(provider.requests[0]?.messages, [
    { content: 'persisted', role: 'user' },
    { content: 'hello', role: 'user' },
  ]);
});

test('createTurnStreamFactory emits one plugin event per turn across repeated turns', async () => {
  const turnStartedIds: string[] = [];
  const { streamTurn } = createStreamTurnFactory({
    plugins: [
      {
        name: 'test-plugin',
        onEvent(event) {
          if (event.type === 'turn_started') {
            turnStartedIds.push(event.turnId);
          }
        },
      },
    ],
  });

  await collectChunks(streamTurn('first', false));
  await collectChunks(streamTurn('second', false));

  assert.equal(turnStartedIds.length, 2);
  assert.equal(new Set(turnStartedIds).size, 2);
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
  const reporter = new HarnessEventReporter({
    getSessionId: () => session.id,
    providerName: provider.name,
  });

  const streamTurn = createTurnStreamFactory({
    reporter,
    pluginRunner: createPluginRunner({
      reporter,
      plugins: [],
      runId: reporter.getRunId(),
    }),
    provider,
    session,
    toolRuntimeFactory: createToolRuntimeFactory({ tools: [] }),
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
  assert.equal((await sessionStore.getSession('cancelled-stream-session'))?.messages.length ?? 0, 0);

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

test('createTurnStreamFactory waits for commit before exposing final_message', async () => {
  let releaseCommit!: () => void;
  const commitRelease = new Promise<void>((resolve) => {
    releaseCommit = resolve;
  });

  class DelayedCommitStore extends MemorySessionStore {
    override async commitTurn(sessionId: string, turnMessages: readonly Message[]): Promise<StoredSessionState> {
      await commitRelease;
      return super.commitTurn(sessionId, turnMessages);
    }
  }

  const { streamTurn } = createStreamTurnFactory({
    sessionStore: new DelayedCommitStore(),
  });
  const iterator = streamTurn('hello', false)[Symbol.asyncIterator]();

  let firstNextResolved = false;
  const firstNext = iterator.next().then((result) => {
    firstNextResolved = true;
    return result;
  });

  await delay(10);
  assert.equal(firstNextResolved, false);

  releaseCommit();

  const finalChunk = await firstNext;
  assert.equal(finalChunk.value?.type, 'final_message');
});

test('createTurnStreamFactory surfaces commit failures instead of yielding final_message', async () => {
  class FailingCommitStore extends MemorySessionStore {
    override async commitTurn(_sessionId: string, _turnMessages: readonly Message[]): Promise<StoredSessionState> {
      throw new Error('commit failed');
    }
  }

  const { session, streamTurn } = createStreamTurnFactory({
    sessionStore: new FailingCommitStore(),
  });

  await assert.rejects(async () => {
    await collectChunks(streamTurn('hello', false));
  }, /commit failed/);

  assert.equal(session.messages.length, 0);
});

test('createTurnStreamFactory return propagates non-abort background failures', async () => {
  let markCommitStarted!: () => void;
  let failCommit!: () => void;
  const commitStarted = new Promise<void>((resolve) => {
    markCommitStarted = resolve;
  });
  const commitFailure = new Promise<void>((_, reject) => {
    failCommit = () => {
      reject(new Error('commit failed'));
    };
  });

  const session = createLiveSession([], 'failing-return-session');
  session.commit = async () => {
    markCommitStarted();
    return commitFailure;
  };

  const provider = new FakeProvider({
    streamReply: [
      { delta: 'partial', type: 'text_delta' },
      {
        response: { text: 'done', usage: createEmptyModelUsage() },
        type: 'response_completed',
      },
    ],
  });
  const reporter = new HarnessEventReporter({
    getSessionId: () => session.id,
    providerName: provider.name,
  });
  const streamTurn = createTurnStreamFactory({
    pluginRunner: createPluginRunner({
      reporter,
      plugins: [],
      runId: reporter.getRunId(),
    }),
    reporter,
    provider,
    session,
    toolRuntimeFactory: createToolRuntimeFactory({ tools: [] }),
  });
  const iterator = streamTurn('hello', true)[Symbol.asyncIterator]();

  const firstChunk = await iterator.next();
  assert.equal(firstChunk.value?.type, 'assistant_delta');

  await commitStarted;

  const returnPromise = iterator.return?.();
  failCommit();

  await assert.rejects(async () => {
    await returnPromise;
  }, /commit failed/);
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

test('createTurnStreamFactory runs afterTurnCommitted in background after a successful commit', async () => {
  let releaseHook!: () => void;
  let markHookStarted!: () => void;
  let markHookFinished!: () => void;
  let observedSessionMessages: { content: string; role: string }[] | null = null;
  let sessionRef: Session;

  const hookStarted = new Promise<void>((resolve) => {
    markHookStarted = resolve;
  });
  const hookFinished = new Promise<void>((resolve) => {
    markHookFinished = resolve;
  });
  const hookRelease = new Promise<void>((resolve) => {
    releaseHook = resolve;
  });

  const { session, streamTurn } = createStreamTurnFactory({
    plugins: [
      {
        async afterTurnCommitted(ctx) {
          observedSessionMessages = sessionRef.messages.map((message) => ({
            content: message.content,
            role: message.role,
          }));
          assert.deepEqual(ctx.historyBeforeTurn, []);
          assert.deepEqual(
            ctx.turnMessages.map((message) => ({ content: message.content, role: message.role })),
            [
              { content: 'hello', role: 'user' },
              { content: 'reply:hello', role: 'assistant' },
            ],
          );
          markHookStarted();
          await hookRelease;
          markHookFinished();
        },
        name: 'memory',
      },
    ],
  });
  sessionRef = session;

  const chunks = await collectChunks(streamTurn('hello', false));

  assert.equal(chunks.at(-1)?.type, 'final_message');
  await hookStarted;
  assert.deepEqual(observedSessionMessages, [
    { content: 'hello', role: 'user' },
    { content: 'reply:hello', role: 'assistant' },
  ]);

  let hookFinishedEarly = false;
  void hookFinished.then(() => {
    hookFinishedEarly = true;
  });
  await delay(0);
  assert.equal(hookFinishedEarly, false);

  releaseHook();
  await hookFinished;
});

test('createTurnStreamFactory does not run afterTurnCommitted when the turn fails', async () => {
  let afterTurnCommittedCalls = 0;
  const session = createTestSession(new MemorySessionStore());
  const provider: ModelProvider = {
    model: 'broken-model',
    name: 'broken-provider',
    async *generate() {
      throw new Error('provider failed');
    },
  };
  const reporter = new HarnessEventReporter({
    getSessionId: () => session.id,
    providerName: provider.name,
  });
  const streamTurn = createTurnStreamFactory({
    pluginRunner: createPluginRunner({
      reporter,
      plugins: [
        {
          afterTurnCommitted() {
            afterTurnCommittedCalls += 1;
          },
          name: 'memory',
        },
      ],
      runId: reporter.getRunId(),
    }),
    reporter,
    provider,
    session,
    toolRuntimeFactory: createToolRuntimeFactory({ tools: [] }),
  });

  await assert.rejects(async () => {
    await collectChunks(streamTurn('hello', false));
  });
  await delay(0);

  assert.equal(afterTurnCommittedCalls, 0);
});

test('createTurnStreamFactory snapshots historyBeforeTurn for live session implementations', async () => {
  const liveMessages: Message[] = [
    {
      content: 'existing user message',
      createdAt: '2024-01-01T00:00:00.000Z',
      role: 'user',
    },
    {
      content: 'existing assistant message',
      createdAt: '2024-01-01T00:00:01.000Z',
      role: 'assistant',
      usage: createEmptyModelUsage(),
    },
  ];
  let capturedHistoryBeforeTurn: { content: string; role: string }[] | null = null;
  const session = createLiveSession(liveMessages, 'live-session');
  const provider = new FakeProvider();
  const reporter = new HarnessEventReporter({
    getSessionId: () => session.id,
    providerName: provider.name,
  });
  const streamTurn = createTurnStreamFactory({
    pluginRunner: createPluginRunner({
      reporter,
      plugins: [
        {
          afterTurnCommitted(ctx) {
            capturedHistoryBeforeTurn = ctx.historyBeforeTurn.map((message) => ({
              content: message.content,
              role: message.role,
            }));
          },
          name: 'memory',
        },
      ],
      runId: reporter.getRunId(),
    }),
    reporter,
    provider,
    session,
    toolRuntimeFactory: createToolRuntimeFactory({ tools: [] }),
  });

  await collectChunks(streamTurn('hello', false));
  await delay(0);

  assert.deepEqual(capturedHistoryBeforeTurn, [
    { content: 'existing user message', role: 'user' },
    { content: 'existing assistant message', role: 'assistant' },
  ]);
});
