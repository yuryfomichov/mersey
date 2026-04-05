import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import { ReadFileTool } from '../tools/read-file.js';
import type { HarnessEvent } from './events/types.js';
import { createHarness, type CreateHarnessOptions } from './harness.js';
import type { ModelProvider } from './models/provider.js';
import { createEmptyModelUsage, type ModelRequest, type ModelStreamEvent } from './models/types.js';
import { FakeProvider } from './providers/fake.js';
import { MemorySessionStore } from './sessions/memory-store.js';
import { Session } from './sessions/session.js';
import type { SessionStore } from './sessions/store.js';
import type { SessionState, StoredSessionState } from './sessions/types.js';
import { withTempDir, writeWorkspaceFiles } from './test/test-helpers.js';

type TestHarnessOptions = Omit<CreateHarnessOptions, 'session'> & {
  session?: Session;
  sessionId?: string;
  sessionStore?: SessionStore;
};

function createTestSession(
  sessionStore: SessionStore = new MemorySessionStore(),
  sessionId = 'local-session',
): Session {
  return new Session({
    id: sessionId,
    store: sessionStore,
  });
}

function createTestHarness(options: TestHarnessOptions = {}) {
  const { session: providedSession, sessionId, sessionStore, ...rest } = options;

  return createHarness({
    ...rest,
    session:
      providedSession ?? createTestSession(sessionStore ?? new MemorySessionStore(), sessionId ?? 'local-session'),
  });
}

test('createHarness requires a provider', () => {
  assert.throws(() => createHarness(), /Missing provider/);
});

test('createHarness uses the injected provider and appends session history', async () => {
  const provider = new FakeProvider();
  const sessionStore = new MemorySessionStore();

  const harness = createTestHarness({ providerInstance: provider, sessionId: 'test-session', sessionStore });
  const reply = await harness.sendMessage('hello');

  assert.equal(reply.role, 'assistant');
  assert.equal(reply.content, 'reply:hello');
  assert.equal(harness.session.id, 'test-session');
  assert.deepEqual(provider.requests[0]?.messages, [{ role: 'user', content: 'hello' }]);
  assert.deepEqual(
    harness.session.messages.map((message) => ({ content: message.content, role: message.role })),
    [
      { content: 'hello', role: 'user' },
      { content: 'reply:hello', role: 'assistant' },
    ],
  );
  assert.deepEqual(
    (await sessionStore.listMessages('test-session')).map((message) => message.content),
    ['hello', 'reply:hello'],
  );
});

test('createHarness emits events with the canonical session id after ensure', async () => {
  const recordedEvents: HarnessEvent[] = [];

  class CanonicalSessionStore extends MemorySessionStore {
    override async getSession(_sessionId: string): Promise<StoredSessionState | null> {
      return null;
    }

    override async createSession(session: SessionState): Promise<StoredSessionState> {
      return {
        ...session,
        contextSize: 0,
        id: 'canonical-session',
        messages: [],
        usage: createEmptyModelUsage(),
      };
    }
  }

  const harness = createTestHarness({
    providerInstance: new FakeProvider(),
    sessionStore: new CanonicalSessionStore(),
  });

  harness.subscribe((event) => {
    recordedEvents.push(event);
  });

  await harness.sendMessage('hello');

  assert.equal(harness.session.id, 'canonical-session');
  assert.ok(recordedEvents.every((event) => event.sessionId === 'canonical-session'));
});

test('createHarness serializes concurrent sendMessage calls for one session', async () => {
  let releaseFirstRequest!: () => void;
  let firstRequestStarted!: () => void;

  const firstRequestStartedPromise = new Promise<void>((resolve) => {
    firstRequestStarted = resolve;
  });
  const releaseFirstRequestPromise = new Promise<void>((resolve) => {
    releaseFirstRequest = resolve;
  });

  const requests: ModelRequest[] = [];
  const provider: ModelProvider = {
    model: 'fake-model',
    name: 'fake',
    async *generate(input: ModelRequest): AsyncIterable<ModelStreamEvent> {
      requests.push(input);

      const lastMessage = input.messages.at(-1);

      if (lastMessage?.role !== 'user') {
        throw new Error('Expected the last message to be a user message.');
      }

      if (lastMessage.content === 'first') {
        firstRequestStarted();
        await releaseFirstRequestPromise;
      }

      yield {
        response: { text: `reply:${lastMessage.content}`, usage: createEmptyModelUsage() },
        type: 'response_completed',
      };
    },
  };
  const harness = createTestHarness({
    providerInstance: provider,
    sessionId: 'concurrent-session',
    sessionStore: new MemorySessionStore(),
  });

  const firstReplyPromise = harness.sendMessage('first');

  await firstRequestStartedPromise;

  const secondReplyPromise = harness.sendMessage('second');

  await delay(0);
  assert.equal(requests.length, 1);

  releaseFirstRequest();

  const [firstReply, secondReply] = await Promise.all([firstReplyPromise, secondReplyPromise]);

  assert.equal(firstReply.content, 'reply:first');
  assert.equal(secondReply.content, 'reply:second');
  assert.deepEqual(requests[1]?.messages, [
    { content: 'first', role: 'user' },
    { content: 'reply:first', role: 'assistant', toolCalls: undefined },
    { content: 'second', role: 'user' },
  ]);
});

test('createHarness emits live events in stable order without leaking raw content', async () => {
  await withTempDir(async (rootDir) => {
    await writeWorkspaceFiles(rootDir, { 'note.txt': 'secret file body' });

    let callCount = 0;
    const events: HarnessEvent[] = [];
    const harness = createTestHarness({
      providerInstance: new FakeProvider({
        reply: () => {
          callCount += 1;

          if (callCount === 1) {
            return {
              text: '',
              toolCalls: [
                {
                  id: 'call-read-1',
                  input: { path: 'note.txt' },
                  name: 'read_file',
                },
              ],
              usage: createEmptyModelUsage(),
            };
          }

          return { text: 'done', usage: createEmptyModelUsage() };
        },
      }),
      sessionId: 'events-session',
      sessionStore: new MemorySessionStore(),
      tools: [new ReadFileTool({ policy: { workspaceRoot: rootDir } })],
    });

    harness.subscribe((event) => {
      events.push(event);
    });

    await harness.sendMessage('read the secret note');

    assert.deepEqual(
      events.map((event) => event.type),
      [
        'session_started',
        'turn_started',
        'iteration_started',
        'provider_requested',
        'provider_responded',
        'tool_requested',
        'tool_started',
        'tool_finished',
        'iteration_started',
        'provider_requested',
        'provider_responded',
        'turn_finished',
      ],
    );

    const serializedEvents = JSON.stringify(events);

    assert.doesNotMatch(serializedEvents, /read the secret note/);
    assert.doesNotMatch(serializedEvents, /secret file body/);
    assert.doesNotMatch(serializedEvents, /"path":"note\.txt"/);
    assert.doesNotMatch(serializedEvents, /\/note\.txt/);
  });
});
