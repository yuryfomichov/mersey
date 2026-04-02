import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import { withTempDir, writeWorkspaceFiles } from '../test/test-helpers.js';
import type { HarnessEvent } from './events/types.js';
import { ApprovalRequiredError, createHarness, type CreateHarnessOptions } from './harness.js';
import type { HarnessRuntimeTrace } from './logger/types.js';
import type { ModelProvider } from './models/provider.js';
import type { ModelRequest, ModelResponse } from './models/types.js';
import { FakeProvider } from './providers/fake.js';
import { MemorySessionStore } from './sessions/memory-store.js';
import { Session } from './sessions/session.js';
import type { SessionStore } from './sessions/store.js';
import type { SessionState } from './sessions/types.js';
import { ReadFileTool } from './tools/read-file.js';

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

async function collectChunks<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const chunks: T[] = [];

  for await (const chunk of iterable) {
    chunks.push(chunk);
  }

  return chunks;
}

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

test('createHarness ready loads pending approval from persisted session state', async () => {
  const sessionStore = new MemorySessionStore();

  await sessionStore.createSession({
    createdAt: '2026-04-02T00:00:00.000Z',
    id: 'pending-approval-session',
    messages: [],
    pendingApproval: {
      assistantMessage: {
        content: '',
        createdAt: '2026-04-02T00:00:01.000Z',
        role: 'assistant',
        toolCalls: [{ id: 'call-1', input: { path: 'note.txt' }, name: 'read_file' }],
      },
      requiredToolCallIds: ['call-1'],
      toolIterations: 1,
      totalToolCalls: 1,
      turnId: 'turn-1',
    },
    turnStatus: 'awaiting_approval',
  });

  const harness = createTestHarness({
    providerInstance: new FakeProvider(),
    sessionId: 'pending-approval-session',
    sessionStore,
  });

  await harness.ready();

  assert.equal(harness.getPendingApproval()?.requiredToolCallIds[0], 'call-1');
});

test('createHarness sendUserMessage throws ApprovalRequiredError without approvalHandler', async () => {
  const harness = createTestHarness({
    providerInstance: new FakeProvider({
      reply: {
        text: '',
        toolCalls: [{ id: 'call-read-1', input: { path: 'note.txt' }, name: 'read_file' }],
      },
    }),
    sessionStore: new MemorySessionStore(),
    toolExecutionPolicy: { workspaceRoot: process.cwd() },
    tools: [{ policy: { action: 'require_approval', type: 'fixed' }, tool: new ReadFileTool() }],
  });

  await assert.rejects(
    () => harness.sendUserMessage('read the note'),
    (error) => error instanceof ApprovalRequiredError && error.pendingApproval.requiredToolCallIds[0] === 'call-read-1',
  );

  assert.equal(harness.getPendingApproval()?.requiredToolCallIds[0], 'call-read-1');
});

test('createHarness accepts empty-string user messages', async () => {
  const harness = createTestHarness({ providerInstance: new FakeProvider() });

  const reply = await harness.sendUserMessage('');

  assert.equal(reply.content, 'reply:');
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
      toolExecutionPolicy: { workspaceRoot: rootDir },
      tools: [{ policy: { action: 'auto_allow', type: 'fixed' }, tool: new ReadFileTool() }],
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

test('createHarness approvalHandler auto-resumes approval-required turns in streamUserMessage', async () => {
  await withTempDir(async (rootDir) => {
    await writeWorkspaceFiles(rootDir, { 'note.txt': 'secret file body' });

    let callCount = 0;
    const harness = createTestHarness({
      approvalHandler: async (pendingApproval) =>
        pendingApproval.requiredToolCallIds.map((toolCallId) => ({ toolCallId, type: 'approve' as const })),
      providerInstance: new FakeProvider({
        reply: (input) => {
          callCount += 1;

          if (callCount === 1) {
            return {
              text: '',
              toolCalls: [{ id: 'call-read-1', input: { path: 'note.txt' }, name: 'read_file' }],
            };
          }

          assert.equal(input.messages.at(-1)?.role, 'tool');
          assert.equal(input.messages.at(-1)?.content, 'secret file body');

          return { text: 'done' };
        },
      }),
      sessionStore: new MemorySessionStore(),
      toolExecutionPolicy: { workspaceRoot: rootDir },
      tools: [{ policy: { action: 'require_approval', type: 'fixed' }, tool: new ReadFileTool() }],
    });

    const chunks = await collectChunks(harness.streamUserMessage('read the note'));

    assert.deepEqual(
      chunks.map((chunk) => chunk.type),
      ['final_message'],
    );
    assert.equal(chunks[0] && chunks[0].type === 'final_message' ? chunks[0].message.content : '', 'done');
  });
});

test('createHarness resumePendingApprovalIfNeeded resumes persisted approvals through approvalHandler', async () => {
  await withTempDir(async (rootDir) => {
    await writeWorkspaceFiles(rootDir, { 'note.txt': 'secret file body' });

    const sessionStore = new MemorySessionStore();

    await sessionStore.createSession({
      createdAt: '2026-04-02T00:00:00.000Z',
      id: 'startup-approval-session',
      messages: [],
      pendingApproval: {
        assistantMessage: {
          content: '',
          createdAt: '2026-04-02T00:00:02.000Z',
          role: 'assistant',
          toolCalls: [{ id: 'call-read-1', input: { path: 'note.txt' }, name: 'read_file' }],
        },
        requiredToolCallIds: ['call-read-1'],
        toolIterations: 1,
        totalToolCalls: 1,
        turnId: 'turn-1',
      },
      turnStatus: 'awaiting_approval',
    });
    await sessionStore.appendMessage('startup-approval-session', {
      content: 'read the note',
      createdAt: '2026-04-02T00:00:01.000Z',
      role: 'user',
    });
    await sessionStore.appendMessage('startup-approval-session', {
      content: '',
      createdAt: '2026-04-02T00:00:02.000Z',
      role: 'assistant',
      toolCalls: [{ id: 'call-read-1', input: { path: 'note.txt' }, name: 'read_file' }],
    });

    const harness = createTestHarness({
      approvalHandler: async (pendingApproval) =>
        pendingApproval.requiredToolCallIds.map((toolCallId) => ({ toolCallId, type: 'approve' as const })),
      providerInstance: new FakeProvider({
        reply: (input) => {
          assert.equal(input.messages.at(-1)?.role, 'tool');
          assert.equal(input.messages.at(-1)?.content, 'secret file body');

          return { text: 'done' };
        },
      }),
      sessionId: 'startup-approval-session',
      sessionStore,
      toolExecutionPolicy: { workspaceRoot: rootDir },
      tools: [{ policy: { action: 'require_approval', type: 'fixed' }, tool: new ReadFileTool() }],
    });

    const chunks = await collectChunks(harness.resumePendingApprovalIfNeeded());

    assert.deepEqual(
      chunks.map((chunk) => chunk.type),
      ['final_message'],
    );
    assert.equal(chunks[0] && chunks[0].type === 'final_message' ? chunks[0].message.content : '', 'done');
    assert.equal(harness.getPendingApproval(), null);
  });
});

test('createHarness emits approval_resolved with approved and denied tool calls', async () => {
  const events: HarnessEvent[] = [];
  let callCount = 0;
  const harness = createTestHarness({
    providerInstance: new FakeProvider({
      reply: (input) => {
        callCount += 1;

        if (callCount === 1) {
          return {
            text: '',
            toolCalls: [
              {
                id: 'call-read-1',
                input: { path: 'note-a.txt' },
                name: 'read_file',
              },
              {
                id: 'call-read-2',
                input: { path: 'note-b.txt' },
                name: 'read_file',
              },
            ],
          };
        }

        return { text: 'done' };
      },
    }),
    sessionStore: new MemorySessionStore(),
    toolExecutionPolicy: { workspaceRoot: process.cwd() },
    tools: [{ policy: { action: 'require_approval', type: 'fixed' }, tool: new ReadFileTool() }],
  });

  harness.subscribe((event) => {
    events.push(event);
  });

  await collectChunks(harness.streamUserMessage('read both notes'));
  await harness.sendApproval([
    { toolCallId: 'call-read-1', type: 'approve' },
    { toolCallId: 'call-read-2', type: 'deny' },
  ]);

  const approvalResolvedEvent = events.find((event) => event.type === 'approval_resolved');

  assert.deepEqual(approvalResolvedEvent, {
    approvedCount: 1,
    approvedToolCallIds: ['call-read-1'],
    deniedCount: 1,
    deniedToolCallIds: ['call-read-2'],
    sessionId: 'local-session',
    timestamp: approvalResolvedEvent?.timestamp,
    turnId: approvalResolvedEvent?.turnId,
    type: 'approval_resolved',
  });
});

test('createHarness sendApproval returns another pending approval for chained approval turns', async () => {
  let callCount = 0;
  const harness = createTestHarness({
    providerInstance: new FakeProvider({
      reply: () => {
        callCount += 1;

        if (callCount === 1) {
          return {
            text: '',
            toolCalls: [{ id: 'call-read-1', input: { path: 'note-a.txt' }, name: 'read_file' }],
          };
        }

        if (callCount === 2) {
          return {
            text: '',
            toolCalls: [{ id: 'call-read-2', input: { path: 'note-b.txt' }, name: 'read_file' }],
          };
        }

        return { text: 'done' };
      },
    }),
    sessionStore: new MemorySessionStore(),
    toolExecutionPolicy: { workspaceRoot: process.cwd() },
    tools: [{ policy: { action: 'require_approval', type: 'fixed' }, tool: new ReadFileTool() }],
  });

  await collectChunks(harness.streamUserMessage('read two notes'));

  const secondPendingApproval = await harness.sendApproval([{ toolCallId: 'call-read-1', type: 'deny' }]);

  assert.equal('turnId' in secondPendingApproval, true);
  assert.equal(
    'turnId' in secondPendingApproval ? secondPendingApproval.requiredToolCallIds[0] : undefined,
    'call-read-2',
  );
  assert.equal(harness.session.turnStatus, 'awaiting_approval');
});
