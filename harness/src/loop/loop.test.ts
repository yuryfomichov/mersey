import assert from 'node:assert/strict';
import test from 'node:test';

import { HarnessEventPublisher } from '../events/publisher.js';
import type { HarnessEvent } from '../events/types.js';
import { FakeProvider } from '../providers/fake.js';
import type { Message, SessionState } from '../sessions/types.js';
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

  await collectFinalMessage({
    content: 'hello',
    history: session.messages,
    provider,
    sessionId: session.id,
    systemPrompt: 'You are a helpful assistant.',
    toolPolicy: { workspaceRoot: process.cwd() },
    tools: [],
  });

  assert.equal(provider.requests.length, 2);
  assert.equal(provider.requests[0].systemPrompt, 'You are a helpful assistant.');
  assert.equal(provider.requests[1].systemPrompt, 'You are a helpful assistant.');
});

test('streamLoop omits systemPrompt from provider request when not provided', async () => {
  const session = createSession('no-system-prompt-session');

  const provider = new FakeProvider();

  await collectFinalMessage({
    content: 'hello',
    history: session.messages,
    provider,
    sessionId: session.id,
    toolPolicy: { workspaceRoot: process.cwd() },
    tools: [],
  });

  assert.equal(provider.requests.length, 1);
  assert.equal(provider.requests[0].systemPrompt, undefined);
});

test('streamLoop normalizes empty-string systemPrompt to undefined', async () => {
  const session = createSession('empty-system-prompt-session');

  const provider = new FakeProvider();

  await collectFinalMessage({
    content: 'hello',
    history: session.messages,
    provider,
    sessionId: session.id,
    systemPrompt: '   ',
    toolPolicy: { workspaceRoot: process.cwd() },
    tools: [],
  });

  assert.equal(provider.requests.length, 1);
  assert.equal(provider.requests[0].systemPrompt, undefined);
});

test('streamLoop does not persist assistant tool calls when the tool iteration cap is exceeded', async () => {
  const session = createSession('tool-overflow-session');

  const history = session.messages;

  await assert.rejects(
    () =>
      collectFinalMessage({
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
        toolPolicy: { workspaceRoot: process.cwd() },
        tools: [],
      }),
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

  const { finalMessage, turnMessages } = await collectLoopResult({
    content: 'hello',
    eventPublisher: publisher,
    history: session.messages,
    provider: new FakeProvider(),
    sessionId: session.id,
    toolPolicy: { workspaceRoot: process.cwd() },
    tools: [],
  });

  assert.equal(finalMessage.content, 'reply:hello');
  assert.deepEqual(
    turnMessages.map((message) => message.role),
    ['user', 'assistant'],
  );
  assert.equal(session.messages.length, 0);
});

test('streamLoop owns fallback text when provider returns an empty non-tool reply', async () => {
  const session = createSession('fallback-session');

  const reply = await collectFinalMessage({
    content: 'hello',
    history: session.messages,
    provider: new FakeProvider({
      reply: {
        text: '',
      },
    }),
    sessionId: session.id,
    toolPolicy: { workspaceRoot: process.cwd() },
    tools: [],
  });

  assert.equal(reply.content, 'I could not produce a response for that request.');
});

test('streamLoop yields assistant deltas and final message while events stay coarse', async () => {
  const session = createSession('streaming-session');

  const chunks = [];
  const events: HarnessEvent[] = [];
  const publisher = new HarnessEventPublisher();

  publisher.subscribe((event) => {
    events.push(event);
  });

  const iterator = streamLoop({
    content: 'hello',
    eventPublisher: publisher,
    history: session.messages,
    provider: new FakeProvider({
      streamReply: [
        { delta: 'hel', type: 'text_delta' },
        { delta: 'lo', type: 'text_delta' },
        { response: { text: 'hello' }, type: 'response_completed' },
      ],
    }),
    sessionId: session.id,
    stream: true,
    toolPolicy: { workspaceRoot: process.cwd() },
    tools: [],
  });

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
  const reply = await collectFinalMessage({
    content: 'hello',
    history: session.messages,
    provider,
    sessionId: session.id,
    stream: true,
    toolPolicy: { workspaceRoot: process.cwd() },
    tools: [],
  });

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
  const reply = await collectFinalMessage({
    content: 'hello',
    history: session.messages,
    provider,
    sessionId: session.id,
    stream: true,
    toolPolicy: { workspaceRoot: process.cwd() },
    tools: [],
  });

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
  const reply = await collectFinalMessage({
    content: 'hello',
    history: session.messages,
    provider,
    sessionId: session.id,
    stream: true,
    toolPolicy: { workspaceRoot: process.cwd() },
    tools: [],
  });

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
  const reply = await collectFinalMessage({
    content: 'hello',
    history: session.messages,
    provider,
    sessionId: session.id,
    stream: true,
    toolPolicy: { workspaceRoot: process.cwd() },
    tools: [],
  });

  assert.equal(batchCallCount, 0);
  assert.equal(reply.content, 'stream reply');
});
