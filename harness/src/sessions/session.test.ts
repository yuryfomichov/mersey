import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import { MemorySessionStore } from './memory-store.js';
import { Session } from './session.js';
import type { Message, SessionState } from './types.js';

test('Session snapshots tolerate cyclic message data', async () => {
  const cycle: Record<string, unknown> = {};

  cycle.self = cycle;

  class CyclicStore extends MemorySessionStore {
    override async getSession(_sessionId: string): Promise<SessionState | null> {
      return {
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

  const storedMessage = (await store.listMessages(session.id))[0];
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

    override async getSession(_sessionId: string): Promise<SessionState | null> {
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
    override async getSession(_sessionId: string): Promise<SessionState | null> {
      return null;
    }

    override async createSession(session: SessionState): Promise<SessionState> {
      return {
        ...session,
        createdAt: '2026-03-29T00:00:00.000Z',
        id: 'canonical-session',
        messages: [
          {
            content: 'from-store',
            createdAt: '2026-03-29T00:00:01.000Z',
            role: 'assistant',
          },
        ],
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
});

test('Session.ensure initializes the session once across concurrent first use', async () => {
  class CountingStore extends MemorySessionStore {
    createSessionCalls = 0;
    getSessionCalls = 0;

    override async createSession(session: SessionState): Promise<SessionState> {
      this.createSessionCalls += 1;
      return super.createSession(session);
    }

    override async getSession(sessionId: string): Promise<SessionState | null> {
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
