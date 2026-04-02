import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import type { HarnessEvent } from './events/types.js';
import { createHarness } from './harness.js';
import type { HarnessRuntimeTrace } from './logger/types.js';
import type { ModelProvider } from './models/provider.js';
import type { ModelRequest, ModelResponse } from './models/types.js';
import { FakeProvider } from './providers/fake.js';
import { MemorySessionStore } from './sessions/memory-store.js';
import type { SessionStore } from './sessions/store.js';
import type { Message, SessionState } from './sessions/types.js';
import { createTestHarness, withTempDir, writeWorkspaceFiles } from './test-helpers.js';
import { ReadFileTool } from './tools/read-file.js';
import { RunCommandTool } from './tools/run-command.js';

test('createHarness requires a provider', () => {
  assert.throws(() => createHarness(), /Missing provider/);
});

test('createHarness uses the injected provider and appends session history', async () => {
  const provider = new FakeProvider();
  const sessionStore = new MemorySessionStore();

  const harness = createTestHarness({ providerInstance: provider, sessionId: 'test-session', sessionStore });
  const reply = await harness.sendUserMessage('hello');

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

test('createHarness retries session initialization after a transient store failure', async () => {
  class FlakySessionStore implements SessionStore {
    private failed = false;

    async appendMessage(_sessionId: string, _message: Message): Promise<void> {}

    async createSession(session: SessionState): Promise<SessionState> {
      return {
        ...session,
        messages: [],
      };
    }

    async getSession(_sessionId: string): Promise<SessionState | null> {
      if (!this.failed) {
        this.failed = true;
        throw new Error('temporary failure');
      }

      return null;
    }

    async listMessages(_sessionId: string): Promise<Message[]> {
      return [];
    }
  }

  const harness = createTestHarness({
    providerInstance: new FakeProvider(),
    sessionStore: new FlakySessionStore(),
  });

  await assert.rejects(() => harness.sendUserMessage('hello'), /temporary failure/);

  const reply = await harness.sendUserMessage('hello again');

  assert.equal(reply.content, 'reply:hello again');
});

test('createHarness uses the canonical session returned by the store', async () => {
  class CanonicalSessionStore extends MemorySessionStore {
    override async getSession(_sessionId: string): Promise<SessionState | null> {
      return null;
    }

    override async createSession(session: SessionState): Promise<SessionState> {
      return {
        ...session,
        createdAt: '2026-03-29T00:00:00.000Z',
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

  const harness = createTestHarness({
    providerInstance: new FakeProvider(),
    sessionStore: new CanonicalSessionStore(),
  });

  await harness.sendUserMessage('hello');

  assert.equal(harness.session.createdAt, '2026-03-29T00:00:00.000Z');
  assert.equal(harness.session.messages[0]?.content, 'from-store');
});

test('createHarness emits events and traces with the canonical session id after ensure', async () => {
  const recordedTraces: HarnessRuntimeTrace[] = [];
  const recordedEvents: HarnessEvent[] = [];

  class CanonicalSessionStore extends MemorySessionStore {
    override async getSession(_sessionId: string): Promise<SessionState | null> {
      return null;
    }

    override async createSession(session: SessionState): Promise<SessionState> {
      return {
        ...session,
        id: 'canonical-session',
        messages: [],
      };
    }
  }

  const harness = createTestHarness({
    loggers: [
      {
        log(trace): void {
          recordedTraces.push(trace);
        },
      },
    ],
    providerInstance: new FakeProvider(),
    sessionStore: new CanonicalSessionStore(),
  });

  harness.subscribe((event) => {
    recordedEvents.push(event);
  });

  await harness.sendUserMessage('hello');

  assert.equal(harness.session.id, 'canonical-session');
  assert.ok(
    recordedTraces
      .filter((trace) => trace.type === 'session_started')
      .every((trace) => trace.detail.sessionId === 'canonical-session'),
  );
  assert.ok(recordedEvents.every((event) => event.sessionId === 'canonical-session'));
});

test('createHarness initializes the session once across concurrent first use', async () => {
  class CountingSessionStore extends MemorySessionStore {
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

  let releaseFirstRequest!: () => void;
  let firstRequestStarted!: () => void;

  const firstRequestStartedPromise = new Promise<void>((resolve) => {
    firstRequestStarted = resolve;
  });
  const releaseFirstRequestPromise = new Promise<void>((resolve) => {
    releaseFirstRequest = resolve;
  });

  const provider: ModelProvider = {
    model: 'fake-model',
    name: 'fake',
    async generate(input: ModelRequest): Promise<ModelResponse> {
      const lastMessage = input.messages.at(-1);

      if (lastMessage?.role !== 'user') {
        throw new Error('Expected the last message to be a user message.');
      }

      if (lastMessage.content === 'first') {
        firstRequestStarted();
        await releaseFirstRequestPromise;
      }

      return { text: `reply:${lastMessage.content}` };
    },
  };

  const sessionStore = new CountingSessionStore();
  const harness = createTestHarness({ providerInstance: provider, sessionStore });

  const firstReplyPromise = harness.sendUserMessage('first');

  await firstRequestStartedPromise;

  const secondReplyPromise = harness.sendUserMessage('second');

  releaseFirstRequest();

  await Promise.all([firstReplyPromise, secondReplyPromise]);

  assert.equal(sessionStore.getSessionCalls, 1);
  assert.equal(sessionStore.createSessionCalls, 1);
});

test('createHarness wires tool results back into the next provider request', async () => {
  await withTempDir(async (rootDir) => {
    await writeWorkspaceFiles(rootDir, { 'note.txt': 'hello from file' });

    let callCount = 0;
    const provider = new FakeProvider({
      reply: (input) => {
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
          };
        }

        const lastMessage = input.messages.at(-1);

        assert.equal(lastMessage?.role, 'tool');
        assert.equal(lastMessage?.content, 'hello from file');

        return {
          text: 'done:hello from file',
        };
      },
    });
    const harness = createTestHarness({
      providerInstance: provider,
      sessionId: 'tool-session',
      sessionStore: new MemorySessionStore(),
      toolPolicy: { workspaceRoot: rootDir },
      tools: [new ReadFileTool()],
    });

    const reply = await harness.sendUserMessage('read the note');

    assert.equal(reply.content, 'done:hello from file');
    assert.equal(provider.requests.length, 2);
    assert.deepEqual(
      harness.session.messages.map((message) => message.role),
      ['user', 'assistant', 'tool', 'assistant'],
    );
  });
});

test('createHarness serializes concurrent sendUserMessage calls for one session', async () => {
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
    async generate(input: ModelRequest): Promise<ModelResponse> {
      requests.push(input);

      const lastMessage = input.messages.at(-1);

      if (lastMessage?.role !== 'user') {
        throw new Error('Expected the last message to be a user message.');
      }

      if (lastMessage.content === 'first') {
        firstRequestStarted();
        await releaseFirstRequestPromise;
      }

      return { text: `reply:${lastMessage.content}` };
    },
  };
  const harness = createTestHarness({
    providerInstance: provider,
    sessionId: 'concurrent-session',
    sessionStore: new MemorySessionStore(),
  });

  const firstReplyPromise = harness.sendUserMessage('first');

  await firstRequestStartedPromise;

  const secondReplyPromise = harness.sendUserMessage('second');

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
            };
          }

          return { text: 'done' };
        },
      }),
      sessionId: 'events-session',
      sessionStore: new MemorySessionStore(),
      toolPolicy: { workspaceRoot: rootDir },
      tools: [new ReadFileTool()],
    });

    harness.subscribe((event) => {
      events.push(event);
    });

    await harness.sendUserMessage('read the secret note');

    assert.deepEqual(
      events.map((event) => event.type),
      [
        'turn_started',
        'provider_requested',
        'provider_responded',
        'tool_requested',
        'tool_started',
        'tool_finished',
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

test('createHarness includes debugArgs when debug is enabled', async () => {
  const events: HarnessEvent[] = [];
  const traces: HarnessRuntimeTrace[] = [];
  let callCount = 0;
  const harness = createTestHarness({
    debug: true,
    loggers: [
      {
        log(trace): void {
          traces.push(trace);
        },
      },
    ],
    providerInstance: new FakeProvider({
      reply: () => {
        callCount += 1;

        if (callCount === 1) {
          return {
            text: '',
            toolCalls: [
              {
                id: 'call-run-1',
                input: { args: ['status'], command: 'git', cwd: '.' },
                name: 'run_command',
              },
            ],
          };
        }

        return { text: 'done' };
      },
    }),
    sessionStore: new MemorySessionStore(),
    toolPolicy: { workspaceRoot: process.cwd() },
    tools: [new RunCommandTool()],
  });

  harness.subscribe((event) => {
    events.push(event);
  });

  const reply = await harness.sendUserMessage('run git status');
  const toolRequestedEvent = events.find((event) => event.type === 'tool_requested');
  const toolTrace = traces.find((trace) => trace.type === 'tool_execution_started');

  assert.equal(reply.content, 'done');
  assert.deepEqual(toolRequestedEvent?.type === 'tool_requested' ? toolRequestedEvent.debugArgs : undefined, {
    args: ['status'],
    command: 'git',
    cwd: '.',
  });
  assert.deepEqual((toolTrace?.detail.debugArgs as Record<string, unknown> | undefined) ?? undefined, {
    args: ['status'],
    command: 'git',
    cwd: '.',
  });
});

test('createHarness unsubscribe stops future event delivery', async () => {
  const harness = createTestHarness({
    providerInstance: new FakeProvider(),
    sessionStore: new MemorySessionStore(),
  });
  const events: HarnessEvent[] = [];
  const unsubscribe = harness.subscribe((event) => {
    events.push(event);
  });

  await harness.sendUserMessage('first');
  unsubscribe();
  await harness.sendUserMessage('second');

  assert.deepEqual(
    events.map((event) => event.type),
    ['turn_started', 'provider_requested', 'provider_responded', 'turn_finished'],
  );
});

test('createHarness emits sanitized turn_failed events for provider errors', async () => {
  const events: HarnessEvent[] = [];
  const harness = createTestHarness({
    providerInstance: {
      model: 'broken-model',
      name: 'broken-provider',
      async generate(): Promise<ModelResponse> {
        throw new Error('provider secret: leaked prompt contents');
      },
    },
    sessionStore: new MemorySessionStore(),
  });

  harness.subscribe((event) => {
    events.push(event);
  });

  await assert.rejects(() => harness.sendUserMessage('top secret prompt'), /provider secret/);

  const failedEvent = events.at(-1);

  assert.equal(failedEvent?.type, 'turn_failed');
  assert.equal(failedEvent && failedEvent.type === 'turn_failed' ? failedEvent.errorType : undefined, 'provider');
  assert.equal(
    failedEvent && failedEvent.type === 'turn_failed' ? failedEvent.errorMessage : undefined,
    'Provider request failed.',
  );
  assert.doesNotMatch(JSON.stringify(events), /top secret prompt/);
  assert.doesNotMatch(JSON.stringify(events), /leaked prompt contents/);
});

test('createHarness degrades malformed tool input into a normal tool error', async () => {
  let callCount = 0;
  const events: HarnessEvent[] = [];
  const provider = new FakeProvider({
    reply: (input) => {
      callCount += 1;

      if (callCount === 1) {
        return {
          text: '',
          toolCalls: [
            {
              id: 'call-bad-1',
              input: null as unknown as Record<string, unknown>,
              name: 'read_file',
            },
          ],
        };
      }

      const lastMessage = input.messages.at(-1);

      assert.equal(lastMessage?.role, 'tool');
      assert.equal(lastMessage?.role === 'tool' ? lastMessage.isError : undefined, true);
      assert.match(String(lastMessage?.content), /expected object|requires a string path/);

      return {
        text: 'recovered',
      };
    },
  });
  const harness = createTestHarness({
    providerInstance: provider,
    sessionStore: new MemorySessionStore(),
    toolPolicy: { workspaceRoot: process.cwd() },
    tools: [new ReadFileTool()],
  });

  harness.subscribe((event) => {
    events.push(event);
  });

  const reply = await harness.sendUserMessage('trigger malformed tool call');

  assert.equal(reply.content, 'recovered');
  assert.deepEqual(events[3] && events[3].type === 'tool_requested' ? events[3].safeArgs : undefined, {});
  assert.equal(
    events.some((event) => event.type === 'turn_failed'),
    false,
  );
});

test('createHarness fans out traces to multiple loggers and isolates failures', async () => {
  const recordedTraces: HarnessRuntimeTrace[] = [];
  const harness = createTestHarness({
    loggers: [
      {
        log(trace): void {
          recordedTraces.push(trace);
        },
      },
      {
        log(): void {
          throw new Error('logger failed');
        },
      },
    ],
    providerInstance: new FakeProvider(),
    sessionStore: new MemorySessionStore(),
  });

  const reply = await harness.sendUserMessage('hello');

  assert.equal(reply.content, 'reply:hello');
  assert.ok(recordedTraces.some((trace) => trace.type === 'session_started'));
  assert.ok(recordedTraces.some((trace) => trace.type === 'event_emitted'));
  assert.ok(recordedTraces.some((trace) => trace.type === 'loop_iteration_started'));
});

test('createHarness does not wait for async loggers', async () => {
  const harness = createTestHarness({
    loggers: [
      {
        log(): Promise<void> {
          return new Promise(() => {});
        },
      },
    ],
    providerInstance: new FakeProvider(),
    sessionStore: new MemorySessionStore(),
  });

  const completed = await Promise.race([
    harness.sendUserMessage('hello').then(() => true),
    delay(50).then(() => false),
  ]);

  assert.equal(completed, true);
});

test('createHarness swallows listener failures and logs them', async () => {
  const traces: HarnessRuntimeTrace[] = [];
  const harness = createTestHarness({
    loggers: [
      {
        log(trace): void {
          traces.push(trace);
        },
      },
    ],
    providerInstance: new FakeProvider(),
    sessionStore: new MemorySessionStore(),
  });

  harness.subscribe(() => {
    throw new Error('listener boom');
  });

  const reply = await harness.sendUserMessage('hello');

  assert.equal(reply.content, 'reply:hello');
  assert.ok(traces.some((trace) => trace.type === 'listener_failed'));
});

test('createHarness protects listeners from event mutation by other listeners', async () => {
  await withTempDir(async (rootDir) => {
    await writeWorkspaceFiles(rootDir, { 'note.txt': 'hello from file' });

    let mutationThrew = false;
    let seenBasename: string | undefined;
    let callCount = 0;
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
            };
          }

          return { text: 'done' };
        },
      }),
      sessionStore: new MemorySessionStore(),
      toolPolicy: { workspaceRoot: rootDir },
      tools: [new ReadFileTool()],
    });

    harness.subscribe((event) => {
      if (event.type !== 'tool_requested' || !event.safeArgs.path) {
        return;
      }

      try {
        const pathSummary = event.safeArgs.path;

        pathSummary.basename = 'mutated.txt';
      } catch {
        mutationThrew = true;
      }
    });

    harness.subscribe((event) => {
      if (event.type === 'tool_requested') {
        seenBasename = event.safeArgs.path?.basename;
      }
    });

    await harness.sendUserMessage('read the note');

    assert.equal(mutationThrew, true);
    assert.equal(seenBasename, 'note.txt');
  });
});
