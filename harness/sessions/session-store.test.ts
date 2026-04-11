import assert from 'node:assert/strict';
import { appendFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createEmptyModelUsage } from '../runtime/models/types.js';
import type { Message, SessionState, StoredSessionState } from '../runtime/sessions/types.js';
import { FilesystemSessionStore } from './filesystem-store.js';
import { MemorySessionStore } from './memory-store.js';

async function verifyStoreRoundTrip(store: {
  appendMessage(sessionId: string, message: Message): Promise<void>;
  createSession(session: SessionState): Promise<StoredSessionState>;
  getSession(sessionId: string): Promise<StoredSessionState | null>;
  listMessages(sessionId: string): Promise<Message[]>;
  writeState(sessionId: string, state: Omit<StoredSessionState, 'messages'>): Promise<void>;
}): Promise<void> {
  const session: SessionState = {
    id: 'session-1',
    createdAt: '2026-03-29T00:00:00.000Z',
    messages: [],
  };

  const createdSession = await store.createSession(session);
  assert.deepEqual(createdSession.usage, createEmptyModelUsage());
  assert.equal(createdSession.contextSize, 0);

  await store.writeState(session.id, {
    contextSize: 9,
    createdAt: session.createdAt,
    id: session.id,
    usage: {
      ...createEmptyModelUsage(),
      cachedInputTokens: 2,
      outputTokens: 3,
      uncachedInputTokens: 4,
    },
  });

  await store.appendMessage(session.id, {
    role: 'user',
    content: 'hello',
    createdAt: '2026-03-29T00:00:01.000Z',
  });
  await store.appendMessage(session.id, {
    role: 'assistant',
    content: 'hi',
    createdAt: '2026-03-29T00:00:02.000Z',
    toolCalls: [
      {
        id: 'call-1',
        input: { path: 'note.txt' },
        name: 'read_file',
      },
    ],
  });
  await store.appendMessage(session.id, {
    content: 'file contents',
    createdAt: '2026-03-29T00:00:03.000Z',
    name: 'read_file',
    role: 'tool',
    toolCallId: 'call-1',
  });

  assert.deepEqual(
    (await store.listMessages(session.id)).map((message) => message.content),
    ['hello', 'hi', 'file contents'],
  );
  assert.deepEqual(
    (await store.getSession(session.id))?.messages.map((message) => message.content),
    ['hello', 'hi', 'file contents'],
  );
  assert.deepEqual((await store.getSession(session.id))?.usage, {
    ...createEmptyModelUsage(),
    cachedInputTokens: 2,
    outputTokens: 3,
    uncachedInputTokens: 4,
  });
  assert.equal((await store.getSession(session.id))?.contextSize, 9);

  const storedMessages = await store.listMessages(session.id);

  assert.deepEqual(storedMessages[1] && 'toolCalls' in storedMessages[1] ? storedMessages[1].toolCalls : undefined, [
    {
      id: 'call-1',
      input: { path: 'note.txt' },
      name: 'read_file',
    },
  ]);
  assert.equal(
    storedMessages[2] && 'toolCallId' in storedMessages[2] ? storedMessages[2].toolCallId : undefined,
    'call-1',
  );
}

test('MemorySessionStore persists session messages', async () => {
  await verifyStoreRoundTrip(new MemorySessionStore());
});

test('FilesystemSessionStore persists session messages', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'mersey-'));

  try {
    await verifyStoreRoundTrip(new FilesystemSessionStore({ rootDir }));
  } finally {
    await rm(rootDir, { force: true, recursive: true });
  }
});

test('FilesystemSessionStore rejects traversal-style session ids', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'mersey-'));

  try {
    const store = new FilesystemSessionStore({ rootDir });

    await assert.rejects(
      () =>
        store.createSession({
          id: '../../outside',
          createdAt: '2026-03-29T00:00:00.000Z',
          messages: [],
        }),
      /Invalid session id/,
    );
  } finally {
    await rm(rootDir, { force: true, recursive: true });
  }
});

test('FilesystemSessionStore createSession does not clobber existing messages', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'mersey-'));

  try {
    const store = new FilesystemSessionStore({ rootDir });
    const session: SessionState = {
      id: 'session-1',
      createdAt: '2026-03-29T00:00:00.000Z',
      messages: [],
    };

    await store.createSession(session);
    await store.appendMessage(session.id, {
      role: 'user',
      content: 'hello',
      createdAt: '2026-03-29T00:00:01.000Z',
    });

    const returnedSession = await store.createSession({
      id: session.id,
      createdAt: '2026-03-29T00:00:02.000Z',
      messages: [],
    });

    assert.deepEqual(
      returnedSession.messages.map((message) => message.content),
      ['hello'],
    );
    assert.deepEqual(
      (await store.listMessages(session.id)).map((message) => message.content),
      ['hello'],
    );
  } finally {
    await rm(rootDir, { force: true, recursive: true });
  }
});

test('FilesystemSessionStore skips corrupt JSONL lines and returns the valid messages', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'mersey-'));

  try {
    const store = new FilesystemSessionStore({ rootDir });
    const session: SessionState = {
      id: 'session-1',
      createdAt: '2026-03-29T00:00:00.000Z',
      messages: [],
    };

    await store.createSession(session);
    await store.appendMessage(session.id, {
      role: 'user',
      content: 'hello',
      createdAt: '2026-03-29T00:00:01.000Z',
    });
    await appendFile(join(rootDir, session.id, 'messages.jsonl'), '{bad json}\n', 'utf8');
    await store.appendMessage(session.id, {
      role: 'assistant',
      content: 'hi',
      createdAt: '2026-03-29T00:00:02.000Z',
    });

    assert.deepEqual(
      (await store.listMessages(session.id)).map((message) => message.content),
      ['hello', 'hi'],
    );
  } finally {
    await rm(rootDir, { force: true, recursive: true });
  }
});

test('MemorySessionStore isolates nested message mutations', async () => {
  const store = new MemorySessionStore();
  const session: SessionState = {
    id: 'session-1',
    createdAt: '2026-03-29T00:00:00.000Z',
    messages: [],
  };
  const message: Message = {
    content: 'hi',
    createdAt: '2026-03-29T00:00:02.000Z',
    role: 'assistant',
    toolCalls: [
      {
        id: 'call-1',
        input: { path: 'note.txt' },
        name: 'read_file',
      },
    ],
  };

  await store.createSession(session);
  await store.appendMessage(session.id, message);

  if (message.toolCalls?.[0]) {
    message.toolCalls[0].input = { path: 'changed.txt' };
  }

  const storedMessage = (await store.listMessages(session.id))[0];

  assert.deepEqual(storedMessage && 'toolCalls' in storedMessage ? storedMessage.toolCalls?.[0]?.input : undefined, {
    path: 'note.txt',
  });
});
