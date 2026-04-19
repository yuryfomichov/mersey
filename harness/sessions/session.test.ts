import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import { createEmptyModelUsage } from '../runtime/models/types.js';
import type { Message, SessionState, StoredSessionState } from '../runtime/sessions/types.js';
import { MemorySessionStore } from './memory-store.js';
import { Session } from './session.js';

test('Session snapshots tolerate cyclic message data', async () => {
  const cycle: Record<string, unknown> = {};

  cycle.self = cycle;

  class CyclicStore extends MemorySessionStore {
    override async getSession(_sessionId: string): Promise<StoredSessionState | null> {
      return {
        contextSize: 0,
        createdAt: '2026-03-29T00:00:00.000Z',
        id: 'cyclic-session',
        messages: [
          {
            content: 'tool output',
            createdAt: '2026-03-29T00:00:01.000Z',
            data: cycle,
            name: 'read_file',
            role: 'tool',
            toolCallId: 'call-1',
          },
        ],
        usage: createEmptyModelUsage(),
      };
    }
  }

  const session = new Session({
    id: 'cyclic-session',
    store: new CyclicStore(),
  });

  await session.ensure();

  const messages = session.messages;

  assert.equal(messages.length, 1);
  assert.equal(messages[0]?.role, 'tool');
});

test('Session.commit snapshots caller messages before persistence', async () => {
  const store = new MemorySessionStore();
  const session = new Session({
    id: 'snapshot-session',
    store,
  });
  const message: Message = {
    content: 'hello',
    createdAt: '2026-03-29T00:00:01.000Z',
    role: 'assistant',
    toolCalls: [
      {
        id: 'call-1',
        input: { path: 'note.txt' },
        name: 'read_file',
      },
    ],
  };

  await session.commit([message]);

  if (message.toolCalls?.[0]) {
    message.toolCalls[0].input = { path: 'changed.txt' };
  }

  const storedMessage = (await store.getSession(session.id))?.messages[0];
  const sessionMessage = session.messages[0];

  assert.deepEqual(storedMessage && 'toolCalls' in storedMessage ? storedMessage.toolCalls?.[0]?.input : undefined, {
    path: 'note.txt',
  });
  assert.deepEqual(sessionMessage && 'toolCalls' in sessionMessage ? sessionMessage.toolCalls?.[0]?.input : undefined, {
    path: 'note.txt',
  });
});

test('Session.ensure retries after a transient store failure', async () => {
  class FlakyStore extends MemorySessionStore {
    private failed = false;

    override async getSession(_sessionId: string): Promise<StoredSessionState | null> {
      if (!this.failed) {
        this.failed = true;
        throw new Error('temporary failure');
      }

      return null;
    }
  }

  const session = new Session({
    id: 'retry-session',
    store: new FlakyStore(),
  });

  await assert.rejects(() => session.ensure(), /temporary failure/);
  await assert.doesNotReject(() => session.ensure());
});

test('Session.ensure adopts the canonical session returned by the store', async () => {
  class CanonicalStore extends MemorySessionStore {
    override async getSession(_sessionId: string): Promise<StoredSessionState | null> {
      return null;
    }

    override async createSession(session: SessionState): Promise<StoredSessionState> {
      return {
        ...session,
        contextSize: 3,
        createdAt: '2026-03-29T00:00:00.000Z',
        id: 'canonical-session',
        messages: [
          {
            content: 'from-store',
            createdAt: '2026-03-29T00:00:01.000Z',
            role: 'assistant',
          },
        ],
        usage: {
          ...createEmptyModelUsage(),
          outputTokens: 1,
          uncachedInputTokens: 2,
        },
      };
    }
  }

  const session = new Session({
    id: 'local-session',
    store: new CanonicalStore(),
  });

  await session.ensure();

  assert.equal(session.id, 'canonical-session');
  assert.equal(session.createdAt, '2026-03-29T00:00:00.000Z');
  assert.equal(session.messages[0]?.content, 'from-store');
  assert.deepEqual(await session.getUsage(), {
    ...createEmptyModelUsage(),
    outputTokens: 1,
    uncachedInputTokens: 2,
  });
  assert.equal(await session.getContextSize(), 3);
});

test('Session.ensure initializes the session once across concurrent first use', async () => {
  class CountingStore extends MemorySessionStore {
    createSessionCalls = 0;
    getSessionCalls = 0;

    override async createSession(session: SessionState): Promise<StoredSessionState> {
      this.createSessionCalls += 1;
      return super.createSession(session);
    }

    override async getSession(sessionId: string): Promise<StoredSessionState | null> {
      this.getSessionCalls += 1;
      await delay(5);
      return super.getSession(sessionId);
    }
  }

  const store = new CountingStore();
  const session = new Session({
    id: 'concurrent-session',
    store,
  });

  await Promise.all([session.ensure(), session.ensure(), session.ensure()]);

  assert.equal(store.getSessionCalls, 1);
  assert.equal(store.createSessionCalls, 1);
});

test('Session caches hydrated usage and context values in memory', async () => {
  class CountingStore extends MemorySessionStore {
    getSessionCalls = 0;

    override async getSession(sessionId: string): Promise<StoredSessionState | null> {
      this.getSessionCalls += 1;
      return super.getSession(sessionId);
    }
  }

  const store = new CountingStore();
  await store.createSession({
    createdAt: '2026-03-29T00:00:00.000Z',
    id: 'metrics-session',
    messages: [],
  });
  await store.commitTurn('metrics-session', [], {
    contextSize: 15,
    createdAt: '2026-03-29T00:00:00.000Z',
    id: 'metrics-session',
    usage: {
      ...createEmptyModelUsage(),
      cachedInputTokens: 4,
      outputTokens: 5,
      uncachedInputTokens: 6,
    },
  });

  const session = new Session({
    id: 'metrics-session',
    store,
  });

  assert.deepEqual(await session.getUsage(), {
    ...createEmptyModelUsage(),
    cachedInputTokens: 4,
    outputTokens: 5,
    uncachedInputTokens: 6,
  });
  assert.equal(await session.getContextSize(), 15);
  assert.equal(store.getSessionCalls, 1);
});

test('Session.commit updates cached usage and context metrics', async () => {
  const store = new MemorySessionStore();
  const session = new Session({
    id: 'commit-metrics-session',
    store,
  });

  await session.commit([
    {
      content: 'hello',
      createdAt: '2026-03-29T00:00:01.000Z',
      role: 'assistant',
      usage: {
        ...createEmptyModelUsage(),
        cacheWriteInputTokens: 2,
        cachedInputTokens: 3,
        outputTokens: 7,
        uncachedInputTokens: 5,
      },
    },
  ]);

  assert.deepEqual(await session.getUsage(), {
    ...createEmptyModelUsage(),
    cacheWriteInputTokens: 2,
    cachedInputTokens: 3,
    outputTokens: 7,
    uncachedInputTokens: 5,
  });
  assert.equal(await session.getContextSize(), 17);
  assert.deepEqual((await store.getSession(session.id))?.usage, {
    ...createEmptyModelUsage(),
    cacheWriteInputTokens: 2,
    cachedInputTokens: 3,
    outputTokens: 7,
    uncachedInputTokens: 5,
  });
});

test('Session.commit keeps memory state unchanged when store commitTurn fails', async () => {
  class FailingCommitStore extends MemorySessionStore {
    override async commitTurn(
      _sessionId: string,
      _turnMessages: readonly Message[],
      _state: Omit<StoredSessionState, 'messages'>,
    ): Promise<void> {
      throw new Error('commit failed');
    }
  }

  const session = new Session({
    id: 'failing-commit-session',
    store: new FailingCommitStore(),
  });

  const message: Message = {
    content: 'hello',
    createdAt: '2026-03-29T00:00:01.000Z',
    role: 'assistant',
    usage: {
      ...createEmptyModelUsage(),
      outputTokens: 3,
      uncachedInputTokens: 2,
    },
  };

  await assert.rejects(() => session.commit([message]), /commit failed/);
  assert.deepEqual(session.messages, []);
  assert.deepEqual(await session.getUsage(), createEmptyModelUsage());
  assert.equal(await session.getContextSize(), 0);
});

test('Session.commit serializes concurrent public commits', async () => {
  class SlowCommitStore extends MemorySessionStore {
    commitCalls = 0;

    override async commitTurn(
      sessionId: string,
      turnMessages: readonly Message[],
      state: Omit<StoredSessionState, 'messages'>,
    ): Promise<void> {
      this.commitCalls += 1;

      if (this.commitCalls === 1) {
        await delay(10);
      }

      return super.commitTurn(sessionId, turnMessages, state);
    }
  }

  const store = new SlowCommitStore();
  const session = new Session({
    id: 'serialized-commit-session',
    store,
  });

  await Promise.all([
    session.commit([
      {
        content: 'first',
        createdAt: '2026-03-29T00:00:01.000Z',
        role: 'user',
      },
    ]),
    session.commit([
      {
        content: 'second',
        createdAt: '2026-03-29T00:00:02.000Z',
        role: 'user',
      },
    ]),
  ]);

  assert.deepEqual(
    session.messages.map((message) => message.content),
    ['first', 'second'],
  );
});

test('Session.commit refreshes persisted metrics before public commits from another session instance', async () => {
  const store = new MemorySessionStore();
  const firstSession = new Session({
    id: 'shared-session',
    store,
  });
  const secondSession = new Session({
    id: 'shared-session',
    store,
  });

  await firstSession.commit([
    {
      content: 'first',
      createdAt: '2026-03-29T00:00:01.000Z',
      role: 'assistant',
      usage: {
        ...createEmptyModelUsage(),
        cachedInputTokens: 2,
        outputTokens: 3,
        uncachedInputTokens: 5,
      },
    },
  ]);

  await secondSession.commit([
    {
      content: 'second',
      createdAt: '2026-03-29T00:00:02.000Z',
      role: 'assistant',
      usage: {
        ...createEmptyModelUsage(),
        cacheWriteInputTokens: 1,
        outputTokens: 7,
        uncachedInputTokens: 4,
      },
    },
  ]);

  assert.deepEqual((await store.getSession('shared-session'))?.usage, {
    ...createEmptyModelUsage(),
    cacheWriteInputTokens: 1,
    cachedInputTokens: 2,
    outputTokens: 10,
    uncachedInputTokens: 9,
  });
  assert.equal((await store.getSession('shared-session'))?.contextSize, 12);
  assert.deepEqual(await secondSession.getUsage(), {
    ...createEmptyModelUsage(),
    cacheWriteInputTokens: 1,
    cachedInputTokens: 2,
    outputTokens: 10,
    uncachedInputTokens: 9,
  });
  assert.equal(await secondSession.getContextSize(), 12);
});

test('Session.commit keeps in-memory messages isolated from store-side mutation', async () => {
  class MutatingStore extends MemorySessionStore {
    override async commitTurn(
      sessionId: string,
      turnMessages: readonly Message[],
      state: Omit<StoredSessionState, 'messages'>,
    ): Promise<void> {
      const assistantMessage = turnMessages[0];

      if (assistantMessage && assistantMessage.role === 'assistant') {
        assistantMessage.content = 'mutated by store';
      }

      return super.commitTurn(sessionId, turnMessages, state);
    }
  }

  const session = new Session({
    id: 'mutating-store-session',
    store: new MutatingStore(),
  });

  await session.commit([
    {
      content: 'original content',
      createdAt: '2026-03-29T00:00:01.000Z',
      role: 'assistant',
    },
  ]);

  assert.equal(session.messages[0]?.content, 'original content');
});
