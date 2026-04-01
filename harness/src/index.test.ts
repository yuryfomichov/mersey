import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import { createHarness, type TurnResult } from './harness.js';
import type { HarnessEvent, HarnessRuntimeTrace } from './index.js';
import type { ModelProvider, ModelRequest, ModelResponse } from './models/index.js';
import { parseProviderName } from './providers/factory.js';
import { FakeProvider, type FakeProviderOptions } from './providers/fake.js';
import { MemorySessionStore } from './sessions.js';
import type { Message, Session, SessionStatePatch, SessionStore } from './sessions/index.js';
import { ReadFileTool, RunCommandTool, WriteFileTool } from './tools.js';
import type { Tool } from './tools.js';

function expectCompleted(result: TurnResult): Message {
  assert.equal(result.status, 'completed');
  return result.message;
}

function expectAwaitingApproval(result: TurnResult): Extract<TurnResult, { status: 'awaiting_approval' }>['approval'] {
  assert.equal(result.status, 'awaiting_approval');
  return result.approval;
}

async function withWorkspaceRoot(run: (rootDir: string) => Promise<void>): Promise<void> {
  const rootDir = await mkdtemp(join(tmpdir(), 'mersey-'));

  try {
    await run(rootDir);
  } finally {
    await rm(rootDir, { force: true, recursive: true });
  }
}

function createFakeHarness({
  reply,
  sessionId,
  sessionStore = new MemorySessionStore(),
  toolPolicy = { workspaceRoot: process.cwd() },
  tools,
}: {
  reply: FakeProviderOptions['reply'];
  sessionId?: string;
  sessionStore?: SessionStore;
  toolPolicy?: Record<string, unknown> & { workspaceRoot: string };
  tools: Tool[];
}) {
  return createHarness({
    providerInstance: new FakeProvider({ reply }),
    sessionId,
    sessionStore,
    toolPolicy,
    tools,
  });
}

function createWriteFileToolCall({
  content = 'hello',
  id = 'call-write-1',
  path = 'note.txt',
}: {
  content?: string;
  id?: string;
  path?: string;
} = {}) {
  return {
    id,
    input: { content, path },
    name: 'write_file' as const,
  };
}

test('createHarness uses the injected provider and appends session history', async () => {
  const provider = new FakeProvider();
  const sessionStore = new MemorySessionStore();

  const harness = createHarness({ providerInstance: provider, sessionId: 'test-session', sessionStore });
  const reply = expectCompleted(await harness.sendUserMessage('hello'));

  assert.equal(reply.role, 'assistant');
  assert.equal(reply.content, 'reply:hello');
  assert.equal(harness.session.id, 'test-session');
  assert.equal(provider.requests.length, 1);
  assert.deepEqual(provider.requests[0]?.messages, [{ role: 'user', content: 'hello' }]);
  assert.equal(provider.requests[0]?.tools, undefined);
  assert.deepEqual(
    harness.session.messages.map((message) => ({ role: message.role, content: message.content })),
    [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'reply:hello' },
    ],
  );
  assert.deepEqual(
    (await sessionStore.listMessages('test-session')).map((message) => message.content),
    ['hello', 'reply:hello'],
  );
});

test('parseProviderName supports minimax and rejects unknown providers', () => {
  assert.equal(parseProviderName('fake'), 'fake');
  assert.equal(parseProviderName('minimax'), 'minimax');
  assert.equal(parseProviderName('openai'), 'openai');
  assert.throws(() => parseProviderName('openrouter'), /Unsupported provider/);
});

test('createHarness retries session initialization after a transient store failure', async () => {
  class FlakySessionStore implements SessionStore {
    private failed = false;

    async appendMessage(_sessionId: string, _message: Message): Promise<void> {}

    async createSession(session: Session): Promise<Session> {
      return {
        ...session,
        messages: [],
      };
    }

    async getSession(_sessionId: string): Promise<Session | null> {
      if (!this.failed) {
        this.failed = true;
        throw new Error('temporary failure');
      }

      return null;
    }

    async listMessages(_sessionId: string): Promise<Message[]> {
      return [];
    }

    async updateSessionState(): Promise<void> {}
  }

  const harness = createHarness({
    providerInstance: new FakeProvider(),
    sessionStore: new FlakySessionStore(),
  });

  await assert.rejects(() => harness.sendUserMessage('hello'), /temporary failure/);

  const reply = expectCompleted(await harness.sendUserMessage('hello again'));

  assert.equal(reply.content, 'reply:hello again');
});

test('createHarness uses the canonical session returned by the store', async () => {
  class CanonicalSessionStore extends MemorySessionStore {
    override async getSession(_sessionId: string): Promise<Session | null> {
      return null;
    }

    override async createSession(session: Session): Promise<Session> {
      return {
        ...session,
        createdAt: '2026-03-29T00:00:00.000Z',
        messages: [
          {
            role: 'assistant',
            content: 'from-store',
            createdAt: '2026-03-29T00:00:01.000Z',
          },
        ],
      };
    }

    override async updateSessionState(): Promise<void> {}
  }

  const harness = createHarness({
    providerInstance: new FakeProvider(),
    sessionStore: new CanonicalSessionStore(),
  });

  await harness.sendUserMessage('hello');

  assert.equal(harness.session.createdAt, '2026-03-29T00:00:00.000Z');
  assert.equal(harness.session.messages[0]?.content, 'from-store');
});

test('createHarness executes read_file tool calls and continues the loop', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'mersey-'));

  try {
    await writeFile(join(rootDir, 'note.txt'), 'hello from file', 'utf8');

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
        assert.deepEqual(
          lastMessage?.role === 'tool' && lastMessage.data && 'truncated' in lastMessage.data
            ? lastMessage.data.truncated
            : undefined,
          false,
        );
        assert.match(
          String(
            lastMessage?.role === 'tool' && lastMessage.data && 'path' in lastMessage.data ? lastMessage.data.path : '',
          ),
          /note\.txt$/,
        );

        return {
          text: 'done:hello from file',
        };
      },
    });
    const harness = createHarness({
      providerInstance: provider,
      sessionId: 'tool-session',
      sessionStore: new MemorySessionStore(),
      toolPolicy: { workspaceRoot: rootDir },
      tools: [new ReadFileTool()],
    });

    const reply = expectCompleted(await harness.sendUserMessage('read the note'));

    assert.equal(reply.role, 'assistant');
    assert.equal(reply.content, 'done:hello from file');
    assert.equal(provider.requests.length, 2);
    assert.deepEqual(
      provider.requests[0]?.tools?.map((tool) => tool.name),
      ['read_file'],
    );
    assert.deepEqual(
      harness.session.messages.map((message) => message.role),
      ['user', 'assistant', 'tool', 'assistant'],
    );

    const assistantToolMessage = harness.session.messages[1];

    assert.equal(assistantToolMessage?.role, 'assistant');
    assert.deepEqual(
      assistantToolMessage && 'toolCalls' in assistantToolMessage ? assistantToolMessage.toolCalls : undefined,
      [
        {
          id: 'call-read-1',
          input: { path: 'note.txt' },
          name: 'read_file',
        },
      ],
    );
    assert.equal(harness.session.messages[2]?.content, 'hello from file');
  } finally {
    await rm(rootDir, { force: true, recursive: true });
  }
});

test('createHarness pauses when a tool requires approval and exposes the pending tool call', async () => {
  const harness = createFakeHarness({
    reply: {
      text: '',
      toolCalls: [createWriteFileToolCall()],
    },
    tools: [new WriteFileTool()],
  });

  const approval = expectAwaitingApproval(await harness.sendUserMessage('write the note'));

  assert.equal(approval.toolCallId, 'call-write-1');
  assert.equal(approval.toolName, 'write_file');
  assert.deepEqual(approval.input, { content: 'hello', path: 'note.txt' });
  assert.equal(harness.session.turnStatus, 'awaiting_approval');
  assert.equal(harness.session.pendingApproval?.toolCallId, 'call-write-1');
  assert.equal(harness.session.pendingApproval?.stage, 'awaiting_user');
  assert.equal(typeof harness.session.currentTurnId, 'string');
  assert.deepEqual(
    harness.session.messages.map((message) => message.role),
    ['user', 'assistant'],
  );
  assert.deepEqual(await harness.getPendingApproval(), approval);
  await assert.rejects(() => harness.sendUserMessage('another request'), /Session is awaiting approval/);
});

test('createHarness resumes a paused turn after approval and executes the pending tool', async () => {
  await withWorkspaceRoot(async (rootDir) => {
    let callCount = 0;
    const harness = createFakeHarness({
      reply: (input) => {
        callCount += 1;

        if (callCount === 1) {
          return {
            text: '',
            toolCalls: [createWriteFileToolCall({ content: 'approved write' })],
          };
        }

        const lastMessage = input.messages.at(-1);

        assert.equal(lastMessage?.role, 'tool');
        assert.equal(lastMessage?.content.includes('Wrote file:'), true);
        return { text: 'write complete' };
      },
      toolPolicy: { workspaceRoot: rootDir },
      tools: [new WriteFileTool()],
    });

    expectAwaitingApproval(await harness.sendUserMessage('write the note'));
    const reply = expectCompleted(await harness.approvePendingTool());

    assert.equal(reply.content, 'write complete');
    assert.equal(callCount, 2);
    assert.equal(await harness.getPendingApproval(), null);
    assert.equal(harness.session.turnStatus, 'idle');
    assert.equal(await readFile(join(rootDir, 'note.txt'), 'utf8'), 'approved write');
  });
});

test('createHarness does not rerun an approved tool after a persisted append failure and restart', async () => {
  class FailOnceToolAppendStore extends MemorySessionStore {
    private failed = false;

    override async appendMessage(sessionId: string, message: Message): Promise<void> {
      if (!this.failed && message.role === 'tool' && message.toolCallId === 'call-side-effect-1') {
        this.failed = true;
        throw new Error('transient append failure');
      }

      await super.appendMessage(sessionId, message);
    }
  }

  let executions = 0;
  const sideEffectTool: Tool = {
    description: 'Performs a side effect.',
    async execute() {
      executions += 1;

      return {
        content: `side effect:${executions}`,
      };
    },
    getApprovalRequirement() {
      return { mode: 'require' } as const;
    },
    inputSchema: {
      properties: {},
      type: 'object',
    },
    name: 'side_effect',
  };
  const sessionStore = new FailOnceToolAppendStore();
  const provider = new FakeProvider({
    reply: (input) => {
      const lastMessage = input.messages.at(-1);

      if (lastMessage?.role === 'tool') {
        return { text: 'completed after restart' };
      }

      return {
        text: '',
        toolCalls: [
          {
            id: 'call-side-effect-1',
            input: {},
            name: 'side_effect',
          },
        ],
      };
    },
  });
  const firstHarness = createHarness({
    providerInstance: provider,
    sessionId: 'approval-retry-session',
    sessionStore,
    toolPolicy: { workspaceRoot: process.cwd() },
    tools: [sideEffectTool],
  });

  expectAwaitingApproval(await firstHarness.sendUserMessage('do the side effect'));
  await assert.rejects(() => firstHarness.approvePendingTool(), /transient append failure/);
  assert.equal(executions, 1);
  assert.equal(firstHarness.session.pendingApproval?.stage, 'approved_executed');

  const secondHarness = createHarness({
    providerInstance: provider,
    sessionId: 'approval-retry-session',
    sessionStore,
    toolPolicy: { workspaceRoot: process.cwd() },
    tools: [sideEffectTool],
  });
  const pendingApproval = await secondHarness.getPendingApproval();

  assert.equal(pendingApproval?.toolCallId, 'call-side-effect-1');

  const reply = expectCompleted(await secondHarness.approvePendingTool());

  assert.equal(reply.content, 'completed after restart');
  assert.equal(executions, 1);
  assert.equal(await secondHarness.getPendingApproval(), null);
});

test('createHarness retries approved state persistence after tool execution', async () => {
  class FailOnceApprovedStateStore extends MemorySessionStore {
    private failed = false;

    override async updateSessionState(sessionId: string, patch: SessionStatePatch): Promise<void> {
      if (!this.failed && patch.pendingApproval?.stage === 'approved_executed') {
        this.failed = true;
        throw new Error('transient state failure');
      }

      await super.updateSessionState(sessionId, patch);
    }
  }

  let executions = 0;
  const tool: Tool = {
    description: 'Performs a side effect.',
    async execute() {
      executions += 1;

      return {
        content: `side effect:${executions}`,
      };
    },
    getApprovalRequirement() {
      return { mode: 'require' } as const;
    },
    inputSchema: {
      properties: {},
      type: 'object',
    },
    name: 'side_effect',
  };
  const harness = createHarness({
    providerInstance: new FakeProvider({
      reply: (input) => {
        const lastMessage = input.messages.at(-1);

        if (lastMessage?.role === 'tool') {
          return { text: 'done after retry' };
        }

        return {
          text: '',
          toolCalls: [{ id: 'call-side-effect-1', input: {}, name: 'side_effect' }],
        };
      },
    }),
    sessionStore: new FailOnceApprovedStateStore(),
    toolPolicy: { workspaceRoot: process.cwd() },
    tools: [tool],
  });

  expectAwaitingApproval(await harness.sendUserMessage('do the side effect'));
  const reply = expectCompleted(await harness.approvePendingTool());

  assert.equal(reply.content, 'done after retry');
  assert.equal(executions, 1);
});

test('createHarness resumes remaining tool calls from the same assistant response after approval', async () => {
  await withWorkspaceRoot(async (rootDir) => {
    let callCount = 0;
    const harness = createFakeHarness({
      reply: (input) => {
        callCount += 1;

        if (callCount === 1) {
          return {
            text: '',
            toolCalls: [createWriteFileToolCall({ content: 'batched write' }), { id: 'call-read-1', input: { path: 'note.txt' }, name: 'read_file' }],
          };
        }

        const lastMessage = input.messages.at(-1);

        assert.equal(lastMessage?.role, 'tool');
        assert.equal(lastMessage?.content, 'batched write');
        return { text: 'batch complete' };
      },
      toolPolicy: { workspaceRoot: rootDir },
      tools: [new WriteFileTool(), new ReadFileTool()],
    });

    expectAwaitingApproval(await harness.sendUserMessage('write and read'));
    const reply = expectCompleted(await harness.approvePendingTool());

    assert.equal(reply.content, 'batch complete');
    assert.equal(callCount, 2);
    assert.deepEqual(
      harness.session.messages.map((message) => message.role),
      ['user', 'assistant', 'tool', 'tool', 'assistant'],
    );
  });
});

test('createHarness resumes a paused turn after denial with a tool error', async () => {
  let callCount = 0;
  const harness = createFakeHarness({
    reply: (input) => {
      callCount += 1;

      if (callCount === 1) {
        return {
          text: '',
          toolCalls: [createWriteFileToolCall({ content: 'denied' })],
        };
      }

      const lastMessage = input.messages.at(-1);

      assert.equal(lastMessage?.role, 'tool');
      assert.equal(lastMessage?.role === 'tool' ? lastMessage.isError : undefined, true);
      assert.equal(lastMessage?.content, 'Tool execution denied by user approval.');
      return { text: 'denial handled' };
    },
    tools: [new WriteFileTool()],
  });

  expectAwaitingApproval(await harness.sendUserMessage('write the note'));
  const reply = expectCompleted(await harness.denyPendingTool());

  assert.equal(reply.content, 'denial handled');
  assert.equal(callCount, 2);
  assert.equal(await harness.getPendingApproval(), null);
  assert.equal(harness.session.turnStatus, 'idle');
});

test('createHarness blocks deny after approval has already been consumed', async () => {
  class ExecutingApprovalStore extends MemorySessionStore {
    override async getSession(sessionId: string): Promise<Session | null> {
      const session = await super.getSession(sessionId);

      if (!session) {
        return null;
      }

      return {
        ...session,
        currentTurnId: 'turn-1',
        pendingApproval: {
          stage: 'approved_executing',
          toolCallId: 'call-write-1',
        },
        turnStatus: 'awaiting_approval',
      };
    }
  }

  const sessionStore = new ExecutingApprovalStore();
  const session: Session = {
    createdAt: '2026-03-29T00:00:00.000Z',
    id: 'interrupted-approval-session',
    messages: [
      {
        content: 'write it',
        createdAt: '2026-03-29T00:00:01.000Z',
        role: 'user',
      },
      {
        content: '',
        createdAt: '2026-03-29T00:00:02.000Z',
        role: 'assistant',
        toolCalls: [
          {
            id: 'call-write-1',
            input: { content: 'hello', path: 'note.txt' },
            name: 'write_file',
          },
        ],
      },
    ],
  };

  await sessionStore.createSession(session);
  await sessionStore.appendMessage(session.id, session.messages[0]);
  await sessionStore.appendMessage(session.id, session.messages[1]);

  const harness = createHarness({
    providerInstance: new FakeProvider(),
    sessionId: session.id,
    sessionStore,
    toolPolicy: { workspaceRoot: process.cwd() },
    tools: [new WriteFileTool()],
  });

  await assert.rejects(() => harness.getPendingApproval(), /Automatic retry is blocked to avoid duplicate side effects/);
  await assert.rejects(() => harness.denyPendingTool(), /Automatic retry is blocked to avoid duplicate side effects/);
});

test('createHarness only auto-allows trusted run_command tool calls', async () => {
  let trustedCallCount = 0;
  const trustedHarness = createFakeHarness({
    reply: () => {
      trustedCallCount += 1;

      if (trustedCallCount === 1) {
        return {
          text: '',
          toolCalls: [{ id: 'call-run-1', input: { command: 'pwd' }, name: 'run_command' }],
        };
      }

      return { text: 'trusted command ran' };
    },
    toolPolicy: { commandAllowlist: ['pwd'], workspaceRoot: process.cwd() },
    tools: [new RunCommandTool({ trustedCommands: ['pwd'] })],
  });

  const trustedReply = expectCompleted(await trustedHarness.sendUserMessage('run pwd'));

  assert.equal(trustedReply.content, 'trusted command ran');

  const untrustedHarness = createFakeHarness({
    reply: {
      text: '',
      toolCalls: [{ id: 'call-run-2', input: { args: ['status'], command: 'git' }, name: 'run_command' }],
    },
    toolPolicy: { commandAllowlist: ['git'], workspaceRoot: process.cwd() },
    tools: [new RunCommandTool({ trustedCommands: ['pwd'] })],
  });

  const approval = expectAwaitingApproval(await untrustedHarness.sendUserMessage('run git status'));

  assert.equal(approval.toolName, 'run_command');
  assert.deepEqual(approval.input, { args: ['status'], command: 'git' });
});

test('createHarness emits tool_started and tool_finished after an approval-gated tool is approved', async () => {
  await withWorkspaceRoot(async (rootDir) => {
    let callCount = 0;
    const events: HarnessEvent[] = [];
    const harness = createFakeHarness({
      reply: () => {
        callCount += 1;

        if (callCount === 1) {
          return {
            text: '',
            toolCalls: [createWriteFileToolCall({ content: 'approved body' })],
          };
        }

        return { text: 'done' };
      },
      toolPolicy: { workspaceRoot: rootDir },
      tools: [new WriteFileTool()],
    });

    harness.subscribe((event) => {
      events.push(event);
    });

    const pendingApproval = expectAwaitingApproval(await harness.sendUserMessage('write the note'));

    assert.deepEqual(
      events.map((event) => event.type),
      ['turn_started', 'provider_requested', 'provider_responded', 'tool_requested'],
    );

    const reply = expectCompleted(await harness.approvePendingTool());

    assert.equal(reply.content, 'done');
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

    const toolStartedEvent = events[4];
    const toolFinishedEvent = events[5];

    assert.equal(toolStartedEvent?.type, 'tool_started');
    assert.equal(toolFinishedEvent?.type, 'tool_finished');
    assert.equal(toolStartedEvent?.turnId, pendingApproval.turnId);
    assert.equal(toolFinishedEvent?.turnId, pendingApproval.turnId);
    assert.equal(toolStartedEvent?.type === 'tool_started' ? toolStartedEvent.iteration : undefined, 1);
    assert.equal(toolFinishedEvent?.type === 'tool_finished' ? toolFinishedEvent.iteration : undefined, 1);
    assert.equal(toolStartedEvent?.type === 'tool_started' ? toolStartedEvent.toolCallId : undefined, 'call-write-1');
    assert.equal(toolFinishedEvent?.type === 'tool_finished' ? toolFinishedEvent.toolCallId : undefined, 'call-write-1');
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
  const harness = createHarness({
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

  const [firstReply, secondReply] = (await Promise.all([firstReplyPromise, secondReplyPromise])).map((result) =>
    expectCompleted(result),
  );

  assert.equal(firstReply.content, 'reply:first');
  assert.equal(secondReply.content, 'reply:second');
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[1]?.messages, [
    { content: 'first', role: 'user' },
    { content: 'reply:first', role: 'assistant', toolCalls: undefined },
    { content: 'second', role: 'user' },
  ]);
  assert.deepEqual(
    harness.session.messages.map((message) => ({ content: message.content, role: message.role })),
    [
      { content: 'first', role: 'user' },
      { content: 'reply:first', role: 'assistant' },
      { content: 'second', role: 'user' },
      { content: 'reply:second', role: 'assistant' },
    ],
  );
});

test('createHarness blocks queued user messages once an earlier turn pauses for approval', async () => {
  let releaseFirstRequest!: () => void;
  let firstRequestStarted!: () => void;

  const firstRequestStartedPromise = new Promise<void>((resolve) => {
    firstRequestStarted = resolve;
  });
  const releaseFirstRequestPromise = new Promise<void>((resolve) => {
    releaseFirstRequest = resolve;
  });
  const requests: ModelRequest[] = [];
  const harness = createHarness({
    providerInstance: {
      model: 'fake-model',
      name: 'fake',
      async generate(input: ModelRequest): Promise<ModelResponse> {
        requests.push(input);

        const lastMessage = input.messages.at(-1);

        if (lastMessage?.role === 'user' && lastMessage.content === 'first') {
          firstRequestStarted();
          await releaseFirstRequestPromise;

          return {
            text: '',
            toolCalls: [
              {
                id: 'call-write-1',
                input: { content: 'needs approval', path: 'note.txt' },
                name: 'write_file',
              },
            ],
          };
        }

        return { text: `reply:${lastMessage?.content ?? ''}` };
      },
    },
    sessionStore: new MemorySessionStore(),
    toolPolicy: { workspaceRoot: process.cwd() },
    tools: [new WriteFileTool()],
  });

  const firstReplyPromise = harness.sendUserMessage('first');

  await firstRequestStartedPromise;

  const secondReplyPromise = harness.sendUserMessage('second');

  await delay(0);
  assert.equal(requests.length, 1);

  releaseFirstRequest();

  expectAwaitingApproval(await firstReplyPromise);
  await assert.rejects(secondReplyPromise, /Session is awaiting approval/);
  assert.equal(requests.length, 1);
});

test('createHarness forwards systemPrompt to provider requests', async () => {
  const provider = new FakeProvider();

  const harness = createHarness({
    providerInstance: provider,
    sessionStore: new MemorySessionStore(),
    systemPrompt: 'You are a helpful assistant.',
  });

  await harness.sendUserMessage('hello');

  assert.equal(provider.requests.length, 1);
  assert.equal(provider.requests[0].systemPrompt, 'You are a helpful assistant.');
});

test('createHarness falls back cleanly after a blank post-tool reply', async () => {
  let callCount = 0;
  const provider = new FakeProvider({
    reply: () => {
      callCount += 1;

      if (callCount === 1) {
        return {
          text: '',
          toolCalls: [
            {
              id: 'call-pwd-1',
              input: { command: 'pwd' },
              name: 'run_command',
            },
          ],
        };
      }

      return {
        text: '   ',
      };
    },
  });
  const harness = createHarness({
    providerInstance: provider,
    sessionId: 'pwd-recovery-session',
    sessionStore: new MemorySessionStore(),
    toolPolicy: { commandAllowlist: ['pwd'], workspaceRoot: process.cwd() },
    tools: [new RunCommandTool({ trustedCommands: ['pwd'] })],
  });

  const reply = expectCompleted(await harness.sendUserMessage('what is your current directory?'));

  assert.equal(reply.role, 'assistant');
  assert.equal(reply.content, 'I could not produce a response for that request.');
});

test('createHarness emits live events in stable order without leaking raw content', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'mersey-'));

  try {
    await writeFile(join(rootDir, 'note.txt'), 'secret file body', 'utf8');

    let callCount = 0;
    const events: HarnessEvent[] = [];
    const harness = createHarness({
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

          return {
            text: 'done',
          };
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
    const toolRequestedEvent = events[3];

    assert.equal(toolRequestedEvent?.type, 'tool_requested');
    assert.deepEqual(toolRequestedEvent, {
      iteration: 1,
      safeArgs: {
        path: {
          basename: 'note.txt',
          digest: toolRequestedEvent?.safeArgs.path?.digest,
          length: 8,
          looksAbsolute: false,
          present: true,
        },
      },
      sessionId: 'events-session',
      timestamp: toolRequestedEvent?.timestamp,
      toolCallId: 'call-read-1',
      toolName: 'read_file',
      turnId: toolRequestedEvent?.turnId,
      type: 'tool_requested',
    });
    assert.deepEqual(events[5] && events[5].type === 'tool_finished' ? events[5].resultDataKeys : undefined, [
      'path',
      'truncated',
    ]);

    const serializedEvents = JSON.stringify(events);

    assert.doesNotMatch(serializedEvents, /read the secret note/);
    assert.doesNotMatch(serializedEvents, /secret file body/);
    assert.doesNotMatch(serializedEvents, /"path":"note\.txt"/);
    assert.doesNotMatch(serializedEvents, /\/note\.txt/);
  } finally {
    await rm(rootDir, { force: true, recursive: true });
  }
});

test('createHarness includes debugArgs when debug is enabled', async () => {
  const events: HarnessEvent[] = [];
  const traces: HarnessRuntimeTrace[] = [];
  let callCount = 0;
  const harness = createHarness({
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
    toolPolicy: { commandAllowlist: ['git'], workspaceRoot: process.cwd() },
    tools: [new RunCommandTool({ trustedCommands: ['pwd'] })],
  });

  harness.subscribe((event) => {
    events.push(event);
  });

  expectAwaitingApproval(await harness.sendUserMessage('run git status'));
  const reply = expectCompleted(await harness.approvePendingTool());
  const toolRequestedEvent = events.find((event) => event.type === 'tool_requested');
  const toolTrace = traces.find((trace) => trace.type === 'tool_execution_started');

  assert.equal(reply.content, 'done');
  assert.equal(toolRequestedEvent?.type, 'tool_requested');
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
  const harness = createHarness({
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
  const harness = createHarness({
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

test('createHarness streamUserMessage rejects even when a provider throws undefined', async () => {
  const harness = createHarness({
    providerInstance: {
      model: 'broken-model',
      name: 'broken-provider',
      async generate(): Promise<ModelResponse> {
        throw undefined;
      },
    },
    sessionStore: new MemorySessionStore(),
  });

  await assert.rejects(
    async () => {
      for await (const _chunk of harness.streamUserMessage('hello')) {
        // No-op.
      }
    },
    (error) => error === undefined,
  );
});

test('createHarness streamUserMessage starts on first pull and pre-consumption return is a no-op', async () => {
  const provider = new FakeProvider();
  const harness = createHarness({
    providerInstance: provider,
    sessionStore: new MemorySessionStore(),
  });

  const abandonedIterator = harness.streamUserMessage('abandoned')[Symbol.asyncIterator]();

  assert.equal(provider.requests.length, 0);
  await abandonedIterator.return?.();
  assert.equal(provider.requests.length, 0);

  const iterator = harness.streamUserMessage('hello')[Symbol.asyncIterator]();

  assert.equal(provider.requests.length, 0);

  const firstChunk = await iterator.next();

  assert.equal(provider.requests.length, 1);
  assert.equal(firstChunk.done, false);
  assert.equal(firstChunk.value.type, 'final_message');
  assert.deepEqual(firstChunk.value, {
    message: {
      content: 'reply:hello',
      createdAt: firstChunk.value.message.createdAt,
      role: 'assistant',
      toolCalls: undefined,
    },
    type: 'final_message',
  });
});

test('createHarness streamUserMessage return aborts an active turn and frees the queue', async () => {
  const harness = createHarness({
    providerInstance: new FakeProvider({
      streamReply: async function* (input: ModelRequest) {
        if (input.messages.at(-1)?.role === 'user' && input.messages.at(-1)?.content === 'second') {
          yield { response: { text: 'reply:second' }, type: 'response_completed' };
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
    sessionStore: new MemorySessionStore(),
    stream: true,
  });

  const iterator = harness.streamUserMessage('first')[Symbol.asyncIterator]();
  const firstChunk = await iterator.next();

  assert.equal(firstChunk.done, false);
  assert.equal(firstChunk.value.type, 'assistant_delta');

  await iterator.return?.();

  const reply = await Promise.race([
    harness.sendUserMessage('second'),
    delay(1_000).then(() => {
      throw new Error('second turn stayed blocked after stream cancellation');
    }),
  ]);

  assert.equal(reply.content, 'reply:second');
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
  const harness = createHarness({
    providerInstance: provider,
    sessionStore: new MemorySessionStore(),
    toolPolicy: { workspaceRoot: process.cwd() },
    tools: [new ReadFileTool()],
  });

  harness.subscribe((event) => {
    events.push(event);
  });

  const reply = expectCompleted(await harness.sendUserMessage('trigger malformed tool call'));

  assert.equal(reply.content, 'recovered');
  assert.deepEqual(events[3] && events[3].type === 'tool_requested' ? events[3].safeArgs : undefined, {});
  assert.equal(
    events.some((event) => event.type === 'turn_failed'),
    false,
  );
});

test('createHarness fans out traces to multiple loggers and isolates failures', async () => {
  const recordedTraces: HarnessRuntimeTrace[] = [];
  const harness = createHarness({
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

  const reply = expectCompleted(await harness.sendUserMessage('hello'));

  assert.equal(reply.content, 'reply:hello');
  assert.ok(recordedTraces.some((trace) => trace.type === 'session_started'));
  assert.ok(recordedTraces.some((trace) => trace.type === 'event_emitted'));
  assert.ok(recordedTraces.some((trace) => trace.type === 'loop_iteration_started'));
});

test('createHarness does not wait for async loggers', async () => {
  const harness = createHarness({
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
  const harness = createHarness({
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

  const reply = expectCompleted(await harness.sendUserMessage('hello'));

  assert.equal(reply.content, 'reply:hello');
  assert.ok(traces.some((trace) => trace.type === 'listener_failed'));
});

test('createHarness protects listeners from event mutation by other listeners', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'mersey-'));

  try {
    await writeFile(join(rootDir, 'note.txt'), 'hello from file', 'utf8');

    let mutationThrew = false;
    let seenBasename: string | undefined;
    let callCount = 0;
    const harness = createHarness({
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
  } finally {
    await rm(rootDir, { force: true, recursive: true });
  }
});

test('createHarness streamUserMessage yields final assistant deltas and keeps events coarse', async () => {
  const events: HarnessEvent[] = [];
  const chunks = [];
  const harness = createHarness({
    providerInstance: new FakeProvider({
      streamReply: [
        { delta: 'hel', type: 'text_delta' },
        { delta: 'lo', type: 'text_delta' },
        { response: { text: 'hello' }, type: 'response_completed' },
      ],
    }),
    sessionStore: new MemorySessionStore(),
    stream: true,
  });

  harness.subscribe((event) => {
    events.push(event);
  });

  for await (const chunk of harness.streamUserMessage('hello')) {
    chunks.push(chunk);
  }

  assert.deepEqual(chunks, [
    { delta: 'hel', type: 'assistant_delta' },
    { delta: 'lo', type: 'assistant_delta' },
    {
      message: {
        content: 'hello',
        createdAt: chunks[2]?.type === 'final_message' ? chunks[2].message.createdAt : '',
        role: 'assistant',
        toolCalls: undefined,
      },
      type: 'final_message',
    },
  ]);
  assert.deepEqual(
    events.map((event) => event.type),
    ['turn_started', 'provider_requested', 'provider_responded', 'turn_finished'],
  );
});

test('createHarness streamUserMessage yields only final_message when harness streaming is disabled', async () => {
  const harness = createHarness({
    providerInstance: new FakeProvider({
      reply: 'hello',
      streamReply: [
        { delta: 'hel', type: 'text_delta' },
        { delta: 'lo', type: 'text_delta' },
        { response: { text: 'hello' }, type: 'response_completed' },
      ],
    }),
    sessionStore: new MemorySessionStore(),
    stream: false,
  });
  const chunks = [];

  for await (const chunk of harness.streamUserMessage('hello')) {
    chunks.push(chunk);
  }

  assert.deepEqual(chunks, [
    {
      message: {
        content: 'hello',
        createdAt: chunks[0]?.type === 'final_message' ? chunks[0].message.createdAt : '',
        role: 'assistant',
        toolCalls: undefined,
      },
      type: 'final_message',
    },
  ]);
});
