import assert from 'node:assert/strict';
import test from 'node:test';

import { FakeProvider } from '../../providers/fake.js';
import { ReadFileTool } from '../../tools/read-file.js';
import { HarnessEventEmitter, type HarnessEventSink } from '../events/emitter.js';
import { HarnessEventReporter } from '../events/reporter.js';
import type { HarnessEvent } from '../events/types.js';
import type { ModelProvider } from '../models/provider.js';
import { createEmptyModelUsage } from '../models/types.js';
import { createPluginRunner } from '../plugins/runner.js';
import type { HarnessPlugin } from '../plugins/types.js';
import type { Message, SessionState } from '../sessions/types.js';
import { withTempDir, writeWorkspaceFiles } from '../test/test-helpers.js';
import { createToolRuntimeFactory } from '../tools/runtime/index.js';
import type { Tool } from '../tools/types.js';
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

function createReporter(input: {
  debug?: boolean;
  eventSink?: HarnessEventSink;
  provider: ModelProvider;
  sessionId: string;
}) {
  const reporter = new HarnessEventReporter({
    debug: input.debug,
    getSessionId: () => input.sessionId,
    providerName: input.provider.name,
  });

  reporter.sessionStarted();

  if (input.eventSink) {
    reporter.subscribe((event) => {
      input.eventSink?.publish(event);
    });
  }

  return reporter;
}

function createLoopInput(input: {
  content: string;
  debug?: boolean;
  eventSink?: HarnessEventSink;
  history: readonly Message[];
  options?: Parameters<typeof streamLoop>[0]['options'];
  plugins?: HarnessPlugin[];
  provider: Parameters<typeof streamLoop>[0]['provider'];
  sessionId: string;
  stream?: boolean;
  systemPrompt?: string;
  tools: Tool[];
}): Parameters<typeof streamLoop>[0] {
  const reporter = createReporter({
    debug: input.debug,
    eventSink: input.eventSink,
    provider: input.provider,
    sessionId: input.sessionId,
  });

  return {
    content: input.content,
    history: input.history,
    reporter,
    options: input.options,
    pluginRunner: createPluginRunner({
      reporter,
      plugins: input.plugins ?? [],
      runId: reporter.getRunId(),
    }),
    provider: input.provider,
    stream: input.stream ?? false,
    systemPrompt: input.systemPrompt,
    toolRuntimeFactory: createToolRuntimeFactory({ tools: [...input.tools] }),
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
          usage: createEmptyModelUsage(),
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
      tools: [],
    }),
  );

  assert.equal(provider.requests.length, 1);
  assert.equal(provider.requests[0].systemPrompt, undefined);
});

test('streamLoop applies prepareProviderRequest changes without persisting retrieval context', async () => {
  const session = createSession('request-prep-session');
  const events: HarnessEvent[] = [];
  const eventSink = new HarnessEventEmitter();
  eventSink.subscribe((event: HarnessEvent) => {
    events.push(event);
  });
  const provider = new FakeProvider();

  const { finalMessage, turnMessages } = await collectLoopResult(
    createLoopInput({
      content: 'hello',
      eventSink,
      history: session.messages,
      plugins: [
        {
          name: 'retrieval',
          prepareProviderRequest() {
            return {
              prependMessages: [
                { content: 'Retrieved context\n\n[Source 1: resume.md]\nBuilt payments platform.', role: 'user' },
              ],
            };
          },
        },
      ],
      provider,
      sessionId: session.id,
      tools: [],
    }),
  );

  assert.equal(finalMessage.content, 'reply:hello');
  assert.deepEqual(provider.requests[0]?.messages, [
    { content: 'Retrieved context\n\n[Source 1: resume.md]\nBuilt payments platform.', role: 'user' },
    { content: 'hello', role: 'user' },
  ]);
  assert.deepEqual(
    turnMessages.map((message) => ({ content: message.content, role: message.role })),
    [
      { content: 'hello', role: 'user' },
      { content: 'reply:hello', role: 'assistant' },
    ],
  );
  assert.equal(
    events.some((event) => event.type === 'hook_error'),
    false,
  );
});

test('streamLoop passes immutable snapshots to request-prep hooks', async () => {
  let transcriptMutationFailed = false;
  let userMessageMutationFailed = false;

  const { turnMessages } = await collectLoopResult(
    createLoopInput({
      content: 'hello',
      history: [],
      plugins: [
        {
          name: 'immutability-check',
          prepareProviderRequest(_request, ctx) {
            try {
              (ctx.transcript[0] as Message).content = 'mutated';
            } catch {
              transcriptMutationFailed = true;
            }

            try {
              (ctx.userMessage as Message).role = 'assistant';
            } catch {
              userMessageMutationFailed = true;
            }

            return {};
          },
        },
      ],
      provider: new FakeProvider(),
      sessionId: 'immutability-session',
      tools: [],
    }),
  );

  assert.equal(transcriptMutationFailed, true);
  assert.equal(userMessageMutationFailed, true);
  assert.deepEqual(
    turnMessages.map((message) => ({ content: message.content, role: message.role })),
    [
      { content: 'hello', role: 'user' },
      { content: 'reply:hello', role: 'assistant' },
    ],
  );
});

test('streamLoop skips request-prep snapshots when no request-prep hooks are registered', async () => {
  const session = createSession('no-request-prep-snapshots-session');
  const provider = new FakeProvider();

  session.messages.push({
    content: 'tool output',
    createdAt: new Date().toISOString(),
    data: {
      callback: () => 'not cloneable',
    },
    name: 'example_tool',
    role: 'tool',
    toolCallId: 'call-1',
  });

  const { finalMessage } = await collectLoopResult(
    createLoopInput({
      content: 'hello',
      history: session.messages,
      plugins: [],
      provider,
      sessionId: session.id,
      tools: [],
    }),
  );

  assert.equal(finalMessage.content, 'reply:hello');
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
              usage: createEmptyModelUsage(),
            },
          }),
          sessionId: session.id,
          tools: [],
        }),
      ),
    /Tool loop exceeded 0 iterations/,
  );

  assert.deepEqual(history, []);
});

test('streamLoop swallows event sink failures', async () => {
  const session = createSession('event-sink-session');
  const sink = {
    publish(): void {
      throw new Error('sink failed');
    },
  };

  const provider = new FakeProvider();

  const { finalMessage, turnMessages } = await collectLoopResult(
    createLoopInput({
      content: 'hello',
      history: session.messages,
      eventSink: sink,
      provider,
      sessionId: session.id,
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
      usage: createEmptyModelUsage(),
    },
  });

  const reply = await collectFinalMessage(
    createLoopInput({
      content: 'hello',
      history: session.messages,
      provider,
      sessionId: session.id,
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
            usage: createEmptyModelUsage(),
          };
        }

        const lastMessage = input.messages.at(-1);

        assert.equal(lastMessage?.role, 'tool');
        assert.equal(lastMessage?.content, 'hello from file');

        return {
          text: 'done:hello from file',
          usage: createEmptyModelUsage(),
        };
      },
    });

    const { finalMessage, turnMessages } = await collectLoopResult(
      createLoopInput({
        content: 'read the note',
        history: [],
        provider,
        sessionId: 'tool-session',
        tools: [new ReadFileTool({ policy: { workspaceRoot: rootDir } })],
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
  const eventSink = new HarnessEventEmitter();

  eventSink.subscribe((event: HarnessEvent) => {
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
          usage: createEmptyModelUsage(),
        };
      }

      const lastMessage = input.messages.at(-1);

      assert.equal(lastMessage?.role, 'tool');
      assert.equal(lastMessage?.role === 'tool' ? lastMessage.isError : undefined, true);
      assert.match(String(lastMessage?.content), /expected object|requires a string path/);

      return {
        text: 'recovered',
        usage: createEmptyModelUsage(),
      };
    },
  });

  const { finalMessage, turnMessages } = await collectLoopResult(
    createLoopInput({
      content: 'trigger malformed tool call',
      eventSink,
      history: [],
      provider,
      sessionId: 'tool-error-session',
      tools: [new ReadFileTool({ policy: { workspaceRoot: process.cwd() } })],
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
  const eventSink = new HarnessEventEmitter();

  eventSink.subscribe((event: HarnessEvent) => {
    events.push(event);
  });

  const provider = new FakeProvider({
    streamReply: [
      { delta: 'hel', type: 'text_delta' },
      { delta: 'lo', type: 'text_delta' },
      { response: { text: 'hello', usage: createEmptyModelUsage() }, type: 'response_completed' },
    ],
  });

  const iterator = streamLoop(
    createLoopInput({
      content: 'hello',
      eventSink,
      history: session.messages,
      provider,
      sessionId: session.id,
      stream: true,
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
        usage: createEmptyModelUsage(),
      },
      type: 'final_message',
    },
  ]);
  assert.deepEqual(
    events.map((event) => event.type),
    ['turn_started', 'iteration_started', 'provider_requested', 'provider_responded', 'turn_finished'],
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
              usage: createEmptyModelUsage(),
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

      return [{ response: { text: 'done', usage: createEmptyModelUsage() }, type: 'response_completed' as const }];
    },
  });

  const iterator = streamLoop(
    createLoopInput({
      content: 'hello',
      history: session.messages,
      provider,
      sessionId: session.id,
      stream: true,
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
        usage: createEmptyModelUsage(),
      },
      type: 'final_message',
    },
  ]);
});

test('streamLoop fails when streamed generation throws before any response completes', async () => {
  const session = createSession('stream-runtime-fallback-session');

  const provider = {
    model: 'flaky-stream-model',
    name: 'flaky-stream',
    async *generate() {
      yield* [];
      throw new Error('stream failed');
    },
  };

  await assert.rejects(
    collectFinalMessage(
      createLoopInput({
        content: 'hello',
        history: session.messages,
        provider,
        sessionId: session.id,
        stream: true,
        tools: [],
      }),
    ),
    /stream failed/,
  );
});

test('streamLoop fails when streamed generation emits only empty deltas before failing', async () => {
  const session = createSession('stream-empty-delta-failure-session');

  const provider = {
    model: 'empty-delta-stream-model',
    name: 'empty-delta-stream',
    async *generate() {
      yield { delta: '', type: 'text_delta' as const };
      throw new Error('stream failed');
    },
  };

  await assert.rejects(
    collectFinalMessage(
      createLoopInput({
        content: 'hello',
        history: session.messages,
        provider,
        sessionId: session.id,
        stream: true,
        tools: [],
      }),
    ),
    /stream failed/,
  );
});

test('streamLoop keeps a completed streamed response when provider teardown fails', async () => {
  const session = createSession('stream-teardown-session');

  let batchCallCount = 0;
  const provider = {
    model: 'teardown-stream-model',
    name: 'teardown-stream',
    async *generate(input: { stream: boolean }) {
      if (!input.stream) {
        batchCallCount += 1;
      }

      yield { response: { text: 'stream reply', usage: createEmptyModelUsage() }, type: 'response_completed' as const };
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
      tools: [],
    }),
  );

  assert.equal(batchCallCount, 0);
  assert.equal(reply.content, 'stream reply');
});

test('streamLoop rejects multiple completed responses from one provider turn', async () => {
  const session = createSession('stream-duplicate-completion-session');

  const provider = {
    model: 'duplicate-completion-model',
    name: 'duplicate-completion',
    async *generate() {
      yield { response: { text: 'first', usage: createEmptyModelUsage() }, type: 'response_completed' as const };
      yield { response: { text: 'second', usage: createEmptyModelUsage() }, type: 'response_completed' as const };
    },
  };

  await assert.rejects(
    collectFinalMessage(
      createLoopInput({
        content: 'hello',
        history: session.messages,
        provider,
        sessionId: session.id,
        stream: true,
        tools: [],
      }),
    ),
    /Provider stream returned more than one completed response/,
  );
});

test('streamLoop provider deny path hides non-exposed policy reason and reports provider error type', async () => {
  const events: HarnessEvent[] = [];
  const eventSink = new HarnessEventEmitter();
  eventSink.subscribe((event: HarnessEvent) => {
    events.push(event);
  });

  await assert.rejects(
    collectFinalMessage(
      createLoopInput({
        content: 'hello',
        eventSink,
        history: [],
        plugins: [
          {
            name: 'deny-provider',
            beforeProviderCall() {
              return { continue: false, reason: 'internal policy secret', exposeToModel: false };
            },
          },
        ],
        provider: new FakeProvider(),
        sessionId: 'provider-deny-private',
        tools: [],
      }),
    ),
    /Provider request blocked by policy\./,
  );

  const providerBlocked = events.find((event) => event.type === 'provider_blocked');
  assert.equal(providerBlocked?.type, 'provider_blocked');
  assert.equal(
    providerBlocked?.type === 'provider_blocked' ? providerBlocked.reason : undefined,
    'internal policy secret',
  );

  const failed = events.find((event) => event.type === 'turn_failed');
  assert.equal(failed?.type, 'turn_failed');
  assert.equal(failed?.type === 'turn_failed' ? failed.errorType : undefined, 'provider');
  assert.equal(failed?.type === 'turn_failed' ? failed.errorMessage : undefined, 'Provider request failed.');
});

test('streamLoop provider deny path can expose reason when explicitly allowed', async () => {
  await assert.rejects(
    collectFinalMessage(
      createLoopInput({
        content: 'hello',
        history: [],
        plugins: [
          {
            name: 'deny-provider',
            beforeProviderCall() {
              return { continue: false, reason: 'exposed policy reason', exposeToModel: true };
            },
          },
        ],
        provider: new FakeProvider(),
        sessionId: 'provider-deny-exposed',
        tools: [],
      }),
    ),
    /exposed policy reason/,
  );
});

test('streamLoop prepareProviderRequest hook errors fail closed and report provider error type', async () => {
  const events: HarnessEvent[] = [];
  const eventSink = new HarnessEventEmitter();
  eventSink.subscribe((event: HarnessEvent) => {
    events.push(event);
  });

  await assert.rejects(
    collectFinalMessage(
      createLoopInput({
        content: 'hello',
        eventSink,
        history: [],
        plugins: [
          {
            name: 'retrieval',
            prepareProviderRequest() {
              throw new Error('retrieval failure');
            },
          },
        ],
        provider: new FakeProvider(),
        sessionId: 'prepare-provider-request-deny',
        tools: [],
      }),
    ),
    /Policy check failed/,
  );

  const hookError = events.find((event) => event.type === 'hook_error');
  assert.equal(hookError?.type, 'hook_error');
  assert.equal(hookError?.type === 'hook_error' ? hookError.hookName : undefined, 'prepareProviderRequest');

  const failed = events.find((event) => event.type === 'turn_failed');
  assert.equal(failed?.type, 'turn_failed');
  assert.equal(failed?.type === 'turn_failed' ? failed.errorType : undefined, 'provider');
  assert.equal(failed?.type === 'turn_failed' ? failed.errorMessage : undefined, 'Provider request failed.');
});
