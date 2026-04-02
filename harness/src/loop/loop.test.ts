import assert from 'node:assert/strict';
import test from 'node:test';

import { withTempDir, writeWorkspaceFiles } from '../../test/test-helpers.js';
import { HarnessObserver } from '../events/observer.js';
import type { HarnessEventSink } from '../events/publisher.js';
import { HarnessEventPublisher } from '../events/publisher.js';
import type { HarnessEvent } from '../events/types.js';
import type { ModelProvider } from '../models/provider.js';
import { FakeProvider } from '../providers/fake.js';
import type { Message, SessionState } from '../sessions/types.js';
import { ReadFileTool } from '../tools/read-file.js';
import { streamLoop } from './loop.js';

function createSession(id: string): SessionState {
  return {
    createdAt: new Date().toISOString(),
    id,
    messages: [],
  };
}

async function collectFinalMessage(input: Parameters<typeof streamLoop>[0]): Promise<Message> {
  const { finalMessage } = await collectLoopResult(input);

  return finalMessage;
}

async function collectLoopResult(
  input: Parameters<typeof streamLoop>[0],
): Promise<{ finalMessage: Message; turnMessages: Message[] }> {
  let finalMessage: Message | null = null;
  const iterator = streamLoop(input);

  while (true) {
    const result = await iterator.next();

    if (result.done) {
      if (!finalMessage) {
        throw new Error('Loop ended without a final assistant message.');
      }

      return {
        finalMessage,
        turnMessages: result.value,
      };
    }

    const chunk = result.value;

    if (chunk.type === 'final_message') {
      finalMessage = chunk.message;
    }
  }
}

function createObserver(input: {
  debug?: boolean;
  eventPublisher?: HarnessEventSink;
  provider: ModelProvider;
  sessionId: string;
  tools: Parameters<typeof streamLoop>[0]['tools'];
}) {
  const observer = new HarnessObserver({
    debug: input.debug,
    getSessionId: () => input.sessionId,
    logger: undefined,
    providerName: input.provider.name,
    stream: false,
  });

  observer.sessionStarted();

  if (input.eventPublisher) {
    observer.subscribe((event) => {
      input.eventPublisher?.publish(event);
    });
  }

  return observer;
}

function createLoopInput(input: {
  content: string;
  debug?: boolean;
  eventPublisher?: HarnessEventSink;
  history: readonly Message[];
  options?: Parameters<typeof streamLoop>[0]['options'];
  provider: Parameters<typeof streamLoop>[0]['provider'];
  sessionId: string;
  stream?: boolean;
  systemPrompt?: string;
  toolExecutionPolicy: Parameters<typeof streamLoop>[0]['toolExecutionPolicy'];
  tools: Parameters<typeof streamLoop>[0]['tools'];
}): Parameters<typeof streamLoop>[0] {
  return {
    content: input.content,
    history: input.history,
    observer: createObserver({
      debug: input.debug,
      eventPublisher: input.eventPublisher,
      provider: input.provider,
      sessionId: input.sessionId,
      tools: input.tools,
    }),
    options: input.options,
    provider: input.provider,
    stream: input.stream,
    systemPrompt: input.systemPrompt,
    toolExecutionPolicy: input.toolExecutionPolicy,
    tools: input.tools,
  };
}

test('streamLoop forwards systemPrompt to provider on every generate call including tool-loop iterations', async () => {
  const session = createSession('system-prompt-session');

  let callCount = 0;
  const provider = new FakeProvider({
    reply() {
      callCount += 1;

      if (callCount === 1) {
        return {
          text: '',
          toolCalls: [{ id: 'call-1', input: {}, name: 'missing_tool' }],
        };
      }

      return 'done';
    },
  });

  await collectFinalMessage(
    createLoopInput({
      content: 'hello',
      history: session.messages,
      provider,
      sessionId: session.id,
      systemPrompt: 'You are a helpful assistant.',
      toolExecutionPolicy: { workspaceRoot: process.cwd() },
      tools: [],
    }),
  );

  assert.equal(provider.requests.length, 2);
  assert.equal(provider.requests[0].systemPrompt, 'You are a helpful assistant.');
  assert.equal(provider.requests[1].systemPrompt, 'You are a helpful assistant.');
});

test('streamLoop omits systemPrompt from provider request when not provided', async () => {
  const session = createSession('no-system-prompt-session');

  const provider = new FakeProvider();

  await collectFinalMessage(
    createLoopInput({
      content: 'hello',
      history: session.messages,
      provider,
      sessionId: session.id,
      toolExecutionPolicy: { workspaceRoot: process.cwd() },
      tools: [],
    }),
  );

  assert.equal(provider.requests.length, 1);
  assert.equal(provider.requests[0].systemPrompt, undefined);
});

test('streamLoop normalizes empty-string systemPrompt to undefined', async () => {
  const session = createSession('empty-system-prompt-session');

  const provider = new FakeProvider();

  await collectFinalMessage(
    createLoopInput({
      content: 'hello',
      history: session.messages,
      provider,
      sessionId: session.id,
      systemPrompt: '   ',
      toolExecutionPolicy: { workspaceRoot: process.cwd() },
      tools: [],
    }),
  );

  assert.equal(provider.requests.length, 1);
  assert.equal(provider.requests[0].systemPrompt, undefined);
});

test('streamLoop does not persist assistant tool calls when the tool iteration cap is exceeded', async () => {
  const session = createSession('tool-overflow-session');

  const history = session.messages;

  await assert.rejects(
    () =>
      collectFinalMessage(
        createLoopInput({
          content: 'trigger tool loop',
          history,
          options: { maxToolIterations: 0 },
          provider: new FakeProvider({
            reply: {
              text: '',
              toolCalls: [
                {
                  id: 'call-1',
                  input: {},
                  name: 'missing_tool',
                },
              ],
            },
          }),
          sessionId: session.id,
          toolExecutionPolicy: { workspaceRoot: process.cwd() },
          tools: [],
        }),
      ),
    /Tool loop exceeded 0 iterations/,
  );

  assert.deepEqual(history, []);
});

test('streamLoop swallows event sink failures', async () => {
  const session = createSession('event-sink-session');
  const publisher = {
    publish(): void {
      throw new Error('sink failed');
    },
  };

  const provider = new FakeProvider();

  const { finalMessage, turnMessages } = await collectLoopResult(
    createLoopInput({
      content: 'hello',
      history: session.messages,
      eventPublisher: publisher,
      provider,
      sessionId: session.id,
      toolExecutionPolicy: { workspaceRoot: process.cwd() },
      tools: [],
    }),
  );

  assert.equal(finalMessage.content, 'reply:hello');
  assert.deepEqual(
    turnMessages.map((message) => message.role),
    ['user', 'assistant'],
  );
  assert.equal(session.messages.length, 0);
});

test('streamLoop owns fallback text when provider returns an empty non-tool reply', async () => {
  const session = createSession('fallback-session');

  const provider = new FakeProvider({
    reply: {
      text: '',
    },
  });

  const reply = await collectFinalMessage(
    createLoopInput({
      content: 'hello',
      history: session.messages,
      provider,
      sessionId: session.id,
      toolExecutionPolicy: { workspaceRoot: process.cwd() },
      tools: [],
    }),
  );

  assert.equal(reply.content, 'I could not produce a response for that request.');
});

test('streamLoop wires tool results back into the next provider request', async () => {
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

    const { finalMessage, turnMessages } = await collectLoopResult(
      createLoopInput({
        content: 'read the note',
        history: [],
        provider,
        sessionId: 'tool-session',
        toolExecutionPolicy: { workspaceRoot: rootDir },
        tools: [new ReadFileTool()],
      }),
    );

    assert.equal(finalMessage.content, 'done:hello from file');
    assert.equal(provider.requests.length, 2);
    assert.deepEqual(
      turnMessages.map((message) => message.role),
      ['user', 'assistant', 'tool', 'assistant'],
    );
  });
});

test('streamLoop degrades malformed tool input into a normal tool error', async () => {
  let callCount = 0;
  const events: HarnessEvent[] = [];
  const publisher = new HarnessEventPublisher();

  publisher.subscribe((event) => {
    events.push(event);
  });

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

  const { finalMessage, turnMessages } = await collectLoopResult(
    createLoopInput({
      content: 'trigger malformed tool call',
      eventPublisher: publisher,
      history: [],
      provider,
      sessionId: 'tool-error-session',
      toolExecutionPolicy: { workspaceRoot: process.cwd() },
      tools: [new ReadFileTool()],
    }),
  );

  assert.equal(finalMessage.content, 'recovered');
  assert.equal(turnMessages[2]?.role, 'tool');
  assert.equal(turnMessages[2] && 'isError' in turnMessages[2] ? turnMessages[2].isError : undefined, true);
  const toolRequestedEvent = events.find((event) => event.type === 'tool_requested');

  assert.deepEqual(toolRequestedEvent?.type === 'tool_requested' ? toolRequestedEvent.safeArgs : undefined, {});
  assert.equal(
    events.some((event) => event.type === 'turn_failed'),
    false,
  );
});

test('streamLoop yields assistant deltas and final message while events stay coarse', async () => {
  const session = createSession('streaming-session');

  const chunks = [];
  const events: HarnessEvent[] = [];
  const publisher = new HarnessEventPublisher();

  publisher.subscribe((event) => {
    events.push(event);
  });

  const provider = new FakeProvider({
    streamReply: [
      { delta: 'hel', type: 'text_delta' },
      { delta: 'lo', type: 'text_delta' },
      { response: { text: 'hello' }, type: 'response_completed' },
    ],
  });

  const iterator = streamLoop(
    createLoopInput({
      content: 'hello',
      eventPublisher: publisher,
      history: session.messages,
      provider,
      sessionId: session.id,
      stream: true,
      toolExecutionPolicy: { workspaceRoot: process.cwd() },
      tools: [],
    }),
  );

  while (true) {
    const result = await iterator.next();

    if (result.done) {
      assert.deepEqual(
        result.value.map((message) => message.role),
        ['user', 'assistant'],
      );
      break;
    }

    chunks.push(result.value);
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

test('streamLoop yields assistant_message_completed before tool execution after streamed text', async () => {
  const session = createSession('streaming-tool-session');

  const chunks = [];
  let callCount = 0;
  const provider = new FakeProvider({
    streamReply: () => {
      callCount += 1;

      if (callCount === 1) {
        return [
          { delta: 'thinking', type: 'text_delta' as const },
          {
            response: {
              text: 'thinking',
              toolCalls: [
                {
                  id: 'call-1',
                  input: {},
                  name: 'missing_tool',
                },
              ],
            },
            type: 'response_completed' as const,
          },
        ];
      }

      return [{ response: { text: 'done' }, type: 'response_completed' as const }];
    },
  });

  const iterator = streamLoop(
    createLoopInput({
      content: 'hello',
      history: session.messages,
      provider,
      sessionId: session.id,
      stream: true,
      toolExecutionPolicy: { workspaceRoot: process.cwd() },
      tools: [],
    }),
  );

  while (true) {
    const result = await iterator.next();

    if (result.done) {
      break;
    }

    chunks.push(result.value);
  }

  assert.deepEqual(chunks, [
    { delta: 'thinking', type: 'assistant_delta' },
    { type: 'assistant_message_completed' },
    {
      message: {
        content: 'done',
        createdAt: chunks[2]?.type === 'final_message' ? chunks[2].message.createdAt : '',
        role: 'assistant',
        toolCalls: undefined,
      },
      type: 'final_message',
    },
  ]);
});

test('streamLoop falls back to batch generation when streaming is enabled but unsupported', async () => {
  const session = createSession('stream-fallback-session');

  let callCount = 0;
  const provider = {
    model: 'no-stream-model',
    name: 'no-stream',
    async generate() {
      callCount += 1;
      return { text: 'batch reply' };
    },
  };
  const reply = await collectFinalMessage(
    createLoopInput({
      content: 'hello',
      history: session.messages,
      provider,
      sessionId: session.id,
      stream: true,
      toolExecutionPolicy: { workspaceRoot: process.cwd() },
      tools: [],
    }),
  );

  assert.equal(callCount, 1);
  assert.equal(reply.content, 'batch reply');
});

test('streamLoop falls back to batch generation when streaming fails before any deltas', async () => {
  const session = createSession('stream-runtime-fallback-session');

  let batchCallCount = 0;
  const provider = {
    model: 'flaky-stream-model',
    name: 'flaky-stream',
    async generate() {
      batchCallCount += 1;
      return { text: 'batch reply' };
    },
    stream() {
      throw new Error('stream failed');
    },
  };
  const reply = await collectFinalMessage(
    createLoopInput({
      content: 'hello',
      history: session.messages,
      provider,
      sessionId: session.id,
      stream: true,
      toolExecutionPolicy: { workspaceRoot: process.cwd() },
      tools: [],
    }),
  );

  assert.equal(batchCallCount, 1);
  assert.equal(reply.content, 'batch reply');
});

test('streamLoop falls back to batch generation when streaming emits only empty deltas before failing', async () => {
  const session = createSession('stream-empty-delta-fallback-session');

  let batchCallCount = 0;
  const provider = {
    model: 'empty-delta-stream-model',
    name: 'empty-delta-stream',
    async generate() {
      batchCallCount += 1;
      return { text: 'batch reply' };
    },
    async *stream() {
      yield { delta: '', type: 'text_delta' as const };
      throw new Error('stream failed');
    },
  };
  const reply = await collectFinalMessage(
    createLoopInput({
      content: 'hello',
      history: session.messages,
      provider,
      sessionId: session.id,
      stream: true,
      toolExecutionPolicy: { workspaceRoot: process.cwd() },
      tools: [],
    }),
  );

  assert.equal(batchCallCount, 1);
  assert.equal(reply.content, 'batch reply');
});

test('streamLoop keeps a completed streamed response when stream teardown fails', async () => {
  const session = createSession('stream-teardown-session');

  let batchCallCount = 0;
  const provider = {
    model: 'teardown-stream-model',
    name: 'teardown-stream',
    async generate() {
      batchCallCount += 1;
      return { text: 'batch reply' };
    },
    async *stream() {
      yield { response: { text: 'stream reply' }, type: 'response_completed' as const };
      throw new Error('stream teardown failed');
    },
  };
  const reply = await collectFinalMessage(
    createLoopInput({
      content: 'hello',
      history: session.messages,
      provider,
      sessionId: session.id,
      stream: true,
      toolExecutionPolicy: { workspaceRoot: process.cwd() },
      tools: [],
    }),
  );

  assert.equal(batchCallCount, 0);
  assert.equal(reply.content, 'stream reply');
});
