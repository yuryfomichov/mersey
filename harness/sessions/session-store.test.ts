import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import { createEmptyModelUsage } from '../runtime/models/types.js';
import type { Message, SessionState, StoredSessionState } from '../runtime/sessions/types.js';
import { FilesystemSessionStore } from './filesystem-store.js';
import { MemorySessionStore } from './memory-store.js';

async function verifyStoreRoundTrip(store: {
  commitTurn(
    sessionId: string,
    turnMessages: readonly Message[],
    state: Omit<StoredSessionState, 'messages'>,
  ): Promise<void>;
  createSession(session: SessionState): Promise<StoredSessionState>;
  getSession(sessionId: string): Promise<StoredSessionState | null>;
  runExclusive<T>(sessionId: string, run: () => Promise<T>): Promise<T>;
}): Promise<void> {
  const session: SessionState = {
    id: 'session-1',
    createdAt: '2026-03-29T00:00:00.000Z',
    messages: [],
  };

  const createdSession = await store.createSession(session);
  assert.deepEqual(createdSession.usage, createEmptyModelUsage());
  assert.equal(createdSession.contextSize, 0);

  await store.commitTurn(
    session.id,
    [
      {
        role: 'user',
        content: 'hello',
        createdAt: '2026-03-29T00:00:01.000Z',
      },
      {
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
      },
      {
        content: 'file contents',
        createdAt: '2026-03-29T00:00:03.000Z',
        name: 'read_file',
        role: 'tool',
        toolCallId: 'call-1',
      },
    ],
    {
      contextSize: 9,
      createdAt: session.createdAt,
      id: session.id,
      usage: {
        ...createEmptyModelUsage(),
        cachedInputTokens: 2,
        outputTokens: 3,
        uncachedInputTokens: 4,
      },
    },
  );

  const storedSession = await store.getSession(session.id);

  assert.deepEqual(
    storedSession?.messages.map((message) => message.content),
    ['hello', 'hi', 'file contents'],
  );
  assert.deepEqual(storedSession?.usage, {
    ...createEmptyModelUsage(),
    cachedInputTokens: 2,
    outputTokens: 3,
    uncachedInputTokens: 4,
  });
  assert.equal(storedSession?.contextSize, 9);
  assert.deepEqual(
    storedSession?.messages[1] && 'toolCalls' in storedSession.messages[1]
      ? storedSession.messages[1].toolCalls
      : undefined,
    [
      {
        id: 'call-1',
        input: { path: 'note.txt' },
        name: 'read_file',
      },
    ],
  );
  assert.equal(
    storedSession?.messages[2] && 'toolCallId' in storedSession.messages[2]
      ? storedSession.messages[2].toolCallId
      : undefined,
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
    await store.commitTurn(
      session.id,
      [
        {
          role: 'user',
          content: 'hello',
          createdAt: '2026-03-29T00:00:01.000Z',
        },
      ],
      {
        contextSize: 0,
        createdAt: session.createdAt,
        id: session.id,
        usage: createEmptyModelUsage(),
      },
    );

    const returnedSession = await store.createSession({
      id: session.id,
      createdAt: '2026-03-29T00:00:02.000Z',
      messages: [],
    });

    assert.deepEqual(
      returnedSession.messages.map((message) => message.content),
      ['hello'],
    );
  } finally {
    await rm(rootDir, { force: true, recursive: true });
  }
});

test('FilesystemSessionStore rejects corrupt session files instead of dropping transcript entries', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'mersey-'));

  try {
    const store = new FilesystemSessionStore({ rootDir });
    const session: SessionState = {
      id: 'session-1',
      createdAt: '2026-03-29T00:00:00.000Z',
      messages: [],
    };

    await store.createSession(session);
    await writeFile(join(rootDir, session.id, 'session.json'), '{bad json}\n', 'utf8');

    await assert.rejects(() => store.getSession(session.id), /Unexpected token|Expected property name/);
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
  await store.commitTurn(session.id, [message], {
    contextSize: 0,
    createdAt: session.createdAt,
    id: session.id,
    usage: createEmptyModelUsage(),
  });

  if (message.toolCalls?.[0]) {
    message.toolCalls[0].input = { path: 'changed.txt' };
  }

  const storedMessage = (await store.getSession(session.id))?.messages[0];

  assert.deepEqual(storedMessage && 'toolCalls' in storedMessage ? storedMessage.toolCalls?.[0]?.input : undefined, {
    path: 'note.txt',
  });
});

test('Session stores serialize work per session id, not per session instance', async () => {
  const store = new MemorySessionStore();
  let releaseFirst!: () => void;
  const started: string[] = [];
  const completed: string[] = [];
  const firstRelease = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });

  const firstRun = store.runExclusive('shared-session', async () => {
    started.push('first');
    await firstRelease;
    completed.push('first');
  });

  const secondRun = store.runExclusive('shared-session', async () => {
    started.push('second');
    completed.push('second');
  });

  await Promise.resolve();
  assert.deepEqual(started, ['first']);

  releaseFirst();
  await Promise.all([firstRun, secondRun]);

  assert.deepEqual(started, ['first', 'second']);
  assert.deepEqual(completed, ['first', 'second']);
});

test('FilesystemSessionStore commits turns atomically in a single session file', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'mersey-'));

  try {
    const store = new FilesystemSessionStore({ rootDir });
    await store.createSession({
      id: 'atomic-session',
      createdAt: '2026-03-29T00:00:00.000Z',
      messages: [],
    });

    await store.commitTurn(
      'atomic-session',
      [
        {
          content: 'hello',
          createdAt: '2026-03-29T00:00:01.000Z',
          role: 'user',
        },
      ],
      {
        contextSize: 0,
        createdAt: '2026-03-29T00:00:00.000Z',
        id: 'atomic-session',
        usage: createEmptyModelUsage(),
      },
    );

    const fileContents = await readFile(join(rootDir, 'atomic-session', 'session.json'), 'utf8');
    const storedSession = JSON.parse(fileContents) as StoredSessionState;

    assert.deepEqual(
      storedSession.messages.map((message) => message.content),
      ['hello'],
    );
  } finally {
    await rm(rootDir, { force: true, recursive: true });
  }
});

test('FilesystemSessionStore reclaims stale session locks from dead processes', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'mersey-'));

  try {
    const store = new FilesystemSessionStore({ rootDir });
    const sessionId = 'stale-lock-session';
    const sessionDir = join(rootDir, sessionId);

    await store.createSession({
      id: sessionId,
      createdAt: '2026-03-29T00:00:00.000Z',
      messages: [],
    });
    await writeFile(
      join(sessionDir, 'session.lock'),
      `${JSON.stringify({ createdAt: Date.now(), pid: 999_999 })}\n`,
      'utf8',
    );

    let ran = false;
    await store.runExclusive(sessionId, async () => {
      ran = true;
    });

    assert.equal(ran, true);
  } finally {
    await rm(rootDir, { force: true, recursive: true });
  }
});

test('FilesystemSessionStore reclaims stale unparseable session locks after a grace period', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'mersey-'));

  try {
    const store = new FilesystemSessionStore({ rootDir });
    const sessionId = 'stale-unparseable-lock-session';
    const sessionDir = join(rootDir, sessionId);

    await store.createSession({
      id: sessionId,
      createdAt: '2026-03-29T00:00:00.000Z',
      messages: [],
    });
    await writeFile(join(sessionDir, 'session.lock'), '', 'utf8');
    await delay(120);

    let ran = false;
    await store.runExclusive(sessionId, async () => {
      ran = true;
    });

    assert.equal(ran, true);
  } finally {
    await rm(rootDir, { force: true, recursive: true });
  }
});
