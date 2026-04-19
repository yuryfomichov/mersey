import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import { FakeProvider } from '../../providers/fake.js';
import { HarnessEventReporter } from '../events/reporter.js';
import type { HarnessEvent } from '../events/types.js';
import type { ModelRequest } from '../models/types.js';
import { PluginRunner, createPluginRunner } from './runner.js';
import type {
  AfterTurnCommittedContext,
  BeforeProviderCallContext,
  BeforeToolCallContext,
  HarnessPlugin,
  PrepareProviderRequestContext,
  PrepareProviderRequestMessage,
} from './types.js';

function createTestReporter(): HarnessEventReporter {
  return new HarnessEventReporter({
    getSessionId: () => 'test-session',
    providerName: 'test-provider',
  });
}

function createPluginRunnerWithPlugins(plugins: HarnessPlugin[]): {
  reporter: HarnessEventReporter;
  runner: PluginRunner;
} {
  const reporter = createTestReporter();
  const runner = createPluginRunner({
    reporter,
    plugins,
    runId: 'test-run-id',
  });
  return { reporter, runner };
}

function createBeforeProviderCallContext(): BeforeProviderCallContext {
  return {
    iteration: 1,
    messageCount: 1,
    messageCountsByRole: { user: 1, assistant: 0, tool: 0 },
    model: 'test-model',
    providerName: 'test-provider',
    request: {
      messages: [{ content: 'hello', role: 'user' }],
      stream: false,
      systemPrompt: 'Be helpful.',
      tools: [],
    },
    sessionId: 'test-session',
    toolDefinitionNames: [],
    turnId: 'test-turn',
  };
}

function createPrepareProviderRequestContext(): PrepareProviderRequestContext {
  const userMessage = {
    content: 'hello',
    role: 'user' as const,
  };

  return {
    iteration: 1,
    model: 'test-model',
    providerName: 'test-provider',
    sessionId: 'test-session',
    signal: undefined,
    transcript: [userMessage],
    turnId: 'test-turn',
    userMessage,
  };
}

function createBaseRequest(): ModelRequest {
  return {
    messages: [{ content: 'hello', role: 'user' }],
    stream: false,
    systemPrompt: 'Be helpful.',
    tools: [],
  };
}

function createAfterTurnCommittedContext(
  overrides: Partial<AfterTurnCommittedContext> = {},
): AfterTurnCommittedContext {
  const provider = overrides.provider ?? new FakeProvider();

  return {
    historyBeforeTurn: [],
    model: overrides.model ?? provider.model,
    provider,
    providerName: overrides.providerName ?? provider.name,
    sessionId: 'test-session',
    turnId: 'test-turn',
    turnMessages: [
      {
        content: 'hello',
        createdAt: '2024-01-01T00:00:00.000Z',
        role: 'user',
      },
      {
        content: 'reply:hello',
        createdAt: '2024-01-01T00:00:01.000Z',
        role: 'assistant',
      },
    ],
    ...overrides,
  };
}

test('PluginRunner.runBeforeProviderCall executes in registration order', async () => {
  const callOrder: string[] = [];
  const plugins: HarnessPlugin[] = [
    {
      name: 'plugin-a',
      beforeProviderCall() {
        callOrder.push('plugin-a');
        return { continue: true };
      },
    },
    {
      name: 'plugin-b',
      beforeProviderCall() {
        callOrder.push('plugin-b');
        return { continue: true };
      },
    },
  ];

  const { runner } = createPluginRunnerWithPlugins(plugins);
  const ctx = createBeforeProviderCallContext();

  await runner.runBeforeProviderCall(ctx);

  assert.deepEqual(callOrder, ['plugin-a', 'plugin-b']);
});

test('PluginRunner.runBeforeProviderCall short-circuits on first deny', async () => {
  const callOrder: string[] = [];
  const plugins: HarnessPlugin[] = [
    {
      name: 'plugin-a',
      beforeProviderCall() {
        callOrder.push('plugin-a');
        return { continue: false, reason: 'denied by plugin-a' };
      },
    },
    {
      name: 'plugin-b',
      beforeProviderCall() {
        callOrder.push('plugin-b');
        return { continue: true };
      },
    },
  ];

  const { runner } = createPluginRunnerWithPlugins(plugins);
  const ctx = createBeforeProviderCallContext();

  const decision = await runner.runBeforeProviderCall(ctx);

  assert.deepEqual(callOrder, ['plugin-a']);
  assert.equal(decision.continue, false);
  assert.equal(decision.reason, 'denied by plugin-a');
});

test('PluginRunner.runBeforeProviderCall fails closed on hook error', async () => {
  const events: HarnessEvent[] = [];
  const plugins: HarnessPlugin[] = [
    {
      name: 'plugin-a',
      beforeProviderCall() {
        throw new Error('internal error');
      },
    },
    {
      name: 'plugin-b',
      beforeProviderCall() {
        return { continue: true };
      },
    },
  ];

  const { reporter, runner } = createPluginRunnerWithPlugins(plugins);
  reporter.subscribe((event) => {
    events.push(event);
  });

  const ctx = createBeforeProviderCallContext();

  const decision = await runner.runBeforeProviderCall(ctx);

  assert.equal(decision.continue, false);
  assert.equal(decision.reason, 'Policy check failed');
  const hookError = events.find((event) => event.type === 'hook_error');

  assert.equal(hookError?.type, 'hook_error');
  assert.equal(hookError?.type === 'hook_error' ? hookError.pluginName : undefined, 'plugin-a');
  assert.equal(hookError?.type === 'hook_error' ? hookError.hookName : undefined, 'beforeProviderCall');
});

test('PluginRunner.runPrepareProviderRequest executes in registration order and merges request changes', async () => {
  const callOrder: string[] = [];
  const plugins: HarnessPlugin[] = [
    {
      name: 'plugin-a',
      prepareProviderRequest(request) {
        callOrder.push('plugin-a');
        return {
          prependMessages: [{ content: 'context', role: 'user' }],
          systemPrompt: `${request.systemPrompt}\nUse context.`,
        };
      },
    },
    {
      name: 'plugin-b',
      prepareProviderRequest() {
        callOrder.push('plugin-b');
        return {
          appendMessages: [{ content: 'closing note', role: 'assistant' }],
        };
      },
    },
  ];

  const { runner } = createPluginRunnerWithPlugins(plugins);
  const decision = await runner.runPrepareProviderRequest(createBaseRequest(), {
    ...createPrepareProviderRequestContext(),
  });

  assert.deepEqual(callOrder, ['plugin-a', 'plugin-b']);
  assert.deepEqual(decision.messages, [
    { content: 'context', role: 'user' },
    { content: 'hello', role: 'user' },
    { content: 'closing note', role: 'assistant' },
  ]);
  assert.equal(decision.systemPrompt, 'Be helpful.\nUse context.');
});

test('PluginRunner.runPrepareProviderRequest reuses the original request when hooks make no changes', async () => {
  const plugins: HarnessPlugin[] = [
    {
      name: 'plugin-a',
      prepareProviderRequest() {
        return {};
      },
    },
  ];

  const { runner } = createPluginRunnerWithPlugins(plugins);
  const request = createBaseRequest();
  const decision = await runner.runPrepareProviderRequest(request, {
    ...createPrepareProviderRequestContext(),
  });

  assert.equal(decision, request);
});

test('PluginRunner.runPrepareProviderRequest supports full message replacement', async () => {
  const plugins: HarnessPlugin[] = [
    {
      name: 'plugin-a',
      prepareProviderRequest() {
        return {
          messages: [{ content: 'summary', role: 'user' }],
        };
      },
    },
  ];

  const { runner } = createPluginRunnerWithPlugins(plugins);
  const decision = await runner.runPrepareProviderRequest(createBaseRequest(), {
    ...createPrepareProviderRequestContext(),
  });

  assert.deepEqual(decision.messages, [{ content: 'summary', role: 'user' }]);
});

test('PluginRunner.runPrepareProviderRequest composes message replacement with prepend and append changes', async () => {
  const plugins: HarnessPlugin[] = [
    {
      name: 'plugin-a',
      prepareProviderRequest() {
        return {
          messages: [{ content: 'summary', role: 'user' }],
          prependMessages: [{ content: 'policy', role: 'user' }],
        };
      },
    },
    {
      name: 'plugin-b',
      prepareProviderRequest() {
        return {
          appendMessages: [{ content: 'closing note', role: 'assistant' }],
        };
      },
    },
  ];

  const { runner } = createPluginRunnerWithPlugins(plugins);
  const decision = await runner.runPrepareProviderRequest(createBaseRequest(), {
    ...createPrepareProviderRequestContext(),
  });

  assert.deepEqual(decision.messages, [
    { content: 'policy', role: 'user' },
    { content: 'summary', role: 'user' },
    { content: 'closing note', role: 'assistant' },
  ]);
});

test('PluginRunner.runPrepareProviderRequest passes rewritten request messages to later hooks', async () => {
  let observedMessages: readonly PrepareProviderRequestMessage[] | null = null;
  const plugins: HarnessPlugin[] = [
    {
      name: 'plugin-a',
      prepareProviderRequest() {
        return {
          messages: [{ content: 'summary', role: 'user' }],
        };
      },
    },
    {
      name: 'plugin-b',
      prepareProviderRequest(request) {
        observedMessages = request.messages;
        return {};
      },
    },
  ];

  const { runner } = createPluginRunnerWithPlugins(plugins);
  await runner.runPrepareProviderRequest(createBaseRequest(), {
    ...createPrepareProviderRequestContext(),
  });

  assert.deepEqual(observedMessages, [{ content: 'summary', role: 'user' }]);
});

test('PluginRunner.runPrepareProviderRequest passes immutable request snapshots to hooks', async () => {
  let mutationFailed = false;

  const { runner } = createPluginRunnerWithPlugins([
    {
      name: 'plugin-a',
      prepareProviderRequest(request) {
        try {
          (request.messages as PrepareProviderRequestMessage[]).push({ content: 'mutated', role: 'user' });
        } catch {
          mutationFailed = true;
        }

        return {};
      },
    },
  ]);

  await runner.runPrepareProviderRequest(createBaseRequest(), {
    ...createPrepareProviderRequestContext(),
  });

  assert.equal(mutationFailed, true);
});

test('PluginRunner.runPrepareProviderRequest preserves assistant toolCalls in request snapshots', async () => {
  let observedToolCalls: unknown;

  const { runner } = createPluginRunnerWithPlugins([
    {
      name: 'plugin-a',
      prepareProviderRequest(request) {
        observedToolCalls = request.messages[1]?.role === 'assistant' ? request.messages[1].toolCalls : undefined;
        return {};
      },
    },
  ]);

  await runner.runPrepareProviderRequest(
    {
      messages: [
        { content: 'hello', role: 'user' },
        {
          content: '',
          role: 'assistant',
          toolCalls: [{ id: 'call-1', input: { path: 'note.txt' }, name: 'read_file' }],
        },
      ],
      stream: false,
    },
    {
      ...createPrepareProviderRequestContext(),
    },
  );

  assert.deepEqual(observedToolCalls, [{ id: 'call-1', input: { path: 'note.txt' }, name: 'read_file' }]);
});

test('PluginRunner.runPrepareProviderRequest preserves tool result data in request snapshots', async () => {
  let observedToolData: unknown;

  const { runner } = createPluginRunnerWithPlugins([
    {
      name: 'plugin-a',
      prepareProviderRequest(request) {
        observedToolData = request.messages[1]?.role === 'tool' ? request.messages[1].data : undefined;
        return {};
      },
    },
  ]);

  await runner.runPrepareProviderRequest(
    {
      messages: [
        { content: 'hello', role: 'user' },
        {
          content: 'tool output',
          data: { path: 'note.txt' },
          name: 'read_file',
          role: 'tool',
          toolCallId: 'call-1',
        },
      ],
      stream: false,
    },
    {
      ...createPrepareProviderRequestContext(),
    },
  );

  assert.deepEqual(observedToolData, { path: 'note.txt' });
});

test('PluginRunner request snapshots do not freeze live assistant toolCalls', async () => {
  const request = createBaseRequest();

  request.messages.push({
    content: '',
    role: 'assistant',
    toolCalls: [{ id: 'call-1', input: { path: 'note.txt' }, name: 'read_file' }],
  });

  const { runner } = createPluginRunnerWithPlugins([
    {
      name: 'plugin-a',
      prepareProviderRequest() {
        return {};
      },
    },
  ]);

  await runner.runPrepareProviderRequest(request, {
    ...createPrepareProviderRequestContext(),
  });

  const assistantMessage = request.messages[1];

  if (!assistantMessage || assistantMessage.role !== 'assistant' || !assistantMessage.toolCalls) {
    throw new Error('Expected assistant toolCalls in the live request.');
  }

  const toolCalls = assistantMessage.toolCalls;

  assert.doesNotThrow(() => {
    toolCalls.push({ id: 'call-2', input: { path: 'other.txt' }, name: 'read_file' });
  });
});

test('PluginRunner.runPrepareProviderRequest allows hooks to explicitly clear systemPrompt', async () => {
  const plugins: HarnessPlugin[] = [
    {
      name: 'plugin-a',
      prepareProviderRequest() {
        return {
          systemPrompt: undefined,
        };
      },
    },
  ];

  const { runner } = createPluginRunnerWithPlugins(plugins);
  const decision = await runner.runPrepareProviderRequest(createBaseRequest(), {
    ...createPrepareProviderRequestContext(),
  });

  assert.equal(decision.systemPrompt, undefined);
});

test('PluginRunner.runPrepareProviderRequest fails closed on hook error', async () => {
  const callOrder: string[] = [];
  const events: HarnessEvent[] = [];
  const plugins: HarnessPlugin[] = [
    {
      name: 'plugin-a',
      prepareProviderRequest() {
        callOrder.push('plugin-a');
        throw new Error('internal error');
      },
    },
    {
      name: 'plugin-b',
      prepareProviderRequest() {
        callOrder.push('plugin-b');
        return {};
      },
    },
  ];

  const { reporter, runner } = createPluginRunnerWithPlugins(plugins);
  reporter.subscribe((event) => {
    events.push(event);
  });

  await assert.rejects(
    runner.runPrepareProviderRequest(createBaseRequest(), {
      ...createPrepareProviderRequestContext(),
    }),
    /Policy check failed/,
  );

  assert.deepEqual(callOrder, ['plugin-a']);
  const hookError = events.find((event) => event.type === 'hook_error');

  assert.equal(hookError?.type, 'hook_error');
  assert.equal(hookError?.type === 'hook_error' ? hookError.pluginName : undefined, 'plugin-a');
  assert.equal(hookError?.type === 'hook_error' ? hookError.hookName : undefined, 'prepareProviderRequest');
});

test('PluginRunner.runBeforeToolCall executes in registration order', async () => {
  const callOrder: string[] = [];
  const plugins: HarnessPlugin[] = [
    {
      name: 'plugin-a',
      beforeToolCall() {
        callOrder.push('plugin-a');
        return { continue: true };
      },
    },
    {
      name: 'plugin-b',
      beforeToolCall() {
        callOrder.push('plugin-b');
        return { continue: true };
      },
    },
  ];

  const { runner } = createPluginRunnerWithPlugins(plugins);
  const ctx: BeforeToolCallContext = {
    iteration: 1,
    sessionId: 'test-session',
    toolCall: { id: 'call-1', input: {}, name: 'test_tool' },
    turnId: 'test-turn',
  };

  await runner.runBeforeToolCall(ctx);

  assert.deepEqual(callOrder, ['plugin-a', 'plugin-b']);
});

test('PluginRunner.runBeforeToolCall short-circuits on first deny', async () => {
  const callOrder: string[] = [];
  const plugins: HarnessPlugin[] = [
    {
      name: 'plugin-a',
      beforeToolCall() {
        callOrder.push('plugin-a');
        return { continue: false, reason: 'tool denied' };
      },
    },
    {
      name: 'plugin-b',
      beforeToolCall() {
        callOrder.push('plugin-b');
        return { continue: true };
      },
    },
  ];

  const { runner } = createPluginRunnerWithPlugins(plugins);
  const ctx: BeforeToolCallContext = {
    iteration: 1,
    sessionId: 'test-session',
    toolCall: { id: 'call-1', input: {}, name: 'test_tool' },
    turnId: 'test-turn',
  };

  const decision = await runner.runBeforeToolCall(ctx);

  assert.deepEqual(callOrder, ['plugin-a']);
  assert.equal(decision.continue, false);
  assert.equal(decision.reason, 'tool denied');
});

test('PluginRunner.runBeforeToolCall fails closed on hook error', async () => {
  const events: HarnessEvent[] = [];
  const plugins: HarnessPlugin[] = [
    {
      name: 'plugin-a',
      beforeToolCall() {
        throw new Error('internal error');
      },
    },
    {
      name: 'plugin-b',
      beforeToolCall() {
        return { continue: true };
      },
    },
  ];

  const { reporter, runner } = createPluginRunnerWithPlugins(plugins);
  reporter.subscribe((event) => {
    events.push(event);
  });

  const ctx: BeforeToolCallContext = {
    iteration: 1,
    sessionId: 'test-session',
    toolCall: { id: 'call-1', input: {}, name: 'test_tool' },
    turnId: 'test-turn',
  };

  const decision = await runner.runBeforeToolCall(ctx);

  assert.equal(decision.continue, false);
  assert.equal(decision.reason, 'Policy check failed');
  const hookError = events.find((event) => event.type === 'hook_error');

  assert.equal(hookError?.type, 'hook_error');
  assert.equal(hookError?.type === 'hook_error' ? hookError.pluginName : undefined, 'plugin-a');
  assert.equal(hookError?.type === 'hook_error' ? hookError.hookName : undefined, 'beforeToolCall');
});

test('PluginRunner.runAfterTurnCommitted executes hooks in registration order', async () => {
  const callOrder: string[] = [];
  const plugins: HarnessPlugin[] = [
    {
      afterTurnCommitted() {
        callOrder.push('plugin-a');
      },
      name: 'plugin-a',
    },
    {
      afterTurnCommitted() {
        callOrder.push('plugin-b');
      },
      name: 'plugin-b',
    },
  ];

  const { runner } = createPluginRunnerWithPlugins(plugins);
  runner.runAfterTurnCommitted(createAfterTurnCommittedContext());
  await delay(0);

  assert.deepEqual(callOrder, ['plugin-a', 'plugin-b']);
});

test('PluginRunner.runAfterTurnCommitted is best-effort and reports async hook errors', async () => {
  const events: HarnessEvent[] = [];
  let pluginBRan = false;
  const plugins: HarnessPlugin[] = [
    {
      async afterTurnCommitted() {
        throw new Error('post-commit failure');
      },
      name: 'plugin-a',
    },
    {
      afterTurnCommitted() {
        pluginBRan = true;
      },
      name: 'plugin-b',
    },
  ];

  const { reporter, runner } = createPluginRunnerWithPlugins(plugins);
  reporter.subscribe((event) => {
    events.push(event);
  });

  assert.doesNotThrow(() => {
    runner.runAfterTurnCommitted(createAfterTurnCommittedContext());
  });

  await delay(0);

  const hookError = events.find((event) => event.type === 'hook_error');
  assert.equal(pluginBRan, true);
  assert.equal(hookError?.type, 'hook_error');
  assert.equal(hookError?.type === 'hook_error' ? hookError.pluginName : undefined, 'plugin-a');
  assert.equal(hookError?.type === 'hook_error' ? hookError.hookName : undefined, 'afterTurnCommitted');
});

test('PluginRunner.runAfterTurnCommitted serializes work per session', async () => {
  const callOrder: string[] = [];
  let releaseFirst!: () => void;
  let finishSecond!: () => void;
  const firstHookReleased = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const secondHookFinished = new Promise<void>((resolve) => {
    finishSecond = resolve;
  });
  const plugins: HarnessPlugin[] = [
    {
      async afterTurnCommitted(ctx) {
        callOrder.push(`start:${ctx.turnId}`);

        if (ctx.turnId === 'turn-1') {
          await firstHookReleased;
        }

        callOrder.push(`end:${ctx.turnId}`);

        if (ctx.turnId === 'turn-2') {
          finishSecond();
        }
      },
      name: 'plugin-a',
    },
  ];

  const { runner } = createPluginRunnerWithPlugins(plugins);
  runner.runAfterTurnCommitted(createAfterTurnCommittedContext({ turnId: 'turn-1' }));
  runner.runAfterTurnCommitted(createAfterTurnCommittedContext({ turnId: 'turn-2' }));

  await delay(0);
  assert.deepEqual(callOrder, ['start:turn-1']);

  releaseFirst();
  await secondHookFinished;

  assert.deepEqual(callOrder, ['start:turn-1', 'end:turn-1', 'start:turn-2', 'end:turn-2']);
});

test('PluginRunner.runAfterTurnCommitted does not block other sessions', async () => {
  let releaseFirst!: () => void;
  let markSecondStarted!: () => void;
  const firstHookReleased = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const secondHookStarted = new Promise<void>((resolve) => {
    markSecondStarted = resolve;
  });
  const plugins: HarnessPlugin[] = [
    {
      async afterTurnCommitted(ctx) {
        if (ctx.sessionId === 'session-a') {
          await firstHookReleased;
          return;
        }

        markSecondStarted();
      },
      name: 'plugin-a',
    },
  ];

  const { runner } = createPluginRunnerWithPlugins(plugins);
  runner.runAfterTurnCommitted(createAfterTurnCommittedContext({ sessionId: 'session-a', turnId: 'turn-a' }));
  runner.runAfterTurnCommitted(createAfterTurnCommittedContext({ sessionId: 'session-b', turnId: 'turn-b' }));

  await secondHookStarted;
  releaseFirst();
});

test('PluginRunner delivers events to all plugins via reporter subscription', async () => {
  const receivedEvents: string[] = [];
  const plugins: HarnessPlugin[] = [
    {
      name: 'plugin-a',
      onEvent(event) {
        receivedEvents.push(`plugin-a:${event.type}`);
      },
    },
    {
      name: 'plugin-b',
      onEvent(event) {
        receivedEvents.push(`plugin-b:${event.type}`);
      },
    },
  ];

  const { reporter } = createPluginRunnerWithPlugins(plugins);
  reporter.turnStarted(10);

  assert.deepEqual(receivedEvents, ['plugin-a:turn_started', 'plugin-b:turn_started']);
});

test('PluginRunner event delivery is best-effort and non-blocking', async () => {
  const plugins: HarnessPlugin[] = [
    {
      name: 'plugin-a',
      onEvent() {
        throw new Error('plugin error');
      },
    },
    {
      name: 'plugin-b',
      onEvent() {
        throw new Error('plugin error');
      },
    },
  ];

  const { reporter } = createPluginRunnerWithPlugins(plugins);

  await assert.doesNotReject(
    new Promise<void>((resolve) => {
      reporter.subscribe(() => {
        resolve();
      });
      reporter.turnStarted(10);
    }),
  );
});

test('PluginRunner converts async onEvent errors into hook_error events', async () => {
  const events: HarnessEvent[] = [];
  const plugins: HarnessPlugin[] = [
    {
      name: 'plugin-a',
      async onEvent() {
        throw new Error('async plugin error');
      },
    },
  ];

  const { reporter } = createPluginRunnerWithPlugins(plugins);
  reporter.subscribe((event) => {
    events.push(event);
  });

  reporter.turnStarted(10);
  await delay(0);

  const hookError = events.find((event) => event.type === 'hook_error');

  assert.equal(hookError?.type, 'hook_error');
  assert.equal(hookError?.type === 'hook_error' ? hookError.pluginName : undefined, 'plugin-a');
  assert.equal(hookError?.type === 'hook_error' ? hookError.hookName : undefined, 'onEvent');
  assert.equal(hookError?.type === 'hook_error' ? hookError.errorMessage : undefined, 'Plugin hook failed.');
});

test('PluginRunner preserves the original turn id for async onEvent failures after turn_finished', async () => {
  const events: HarnessEvent[] = [];
  let rejectHook!: (error: Error) => void;
  const hookFailure = new Promise<void>((_, reject) => {
    rejectHook = reject;
  });
  const plugins: HarnessPlugin[] = [
    {
      name: 'plugin-a',
      onEvent(event) {
        if (event.type === 'turn_finished') {
          return hookFailure;
        }

        return undefined;
      },
    },
  ];

  const { reporter } = createPluginRunnerWithPlugins(plugins);
  reporter.subscribe((event) => {
    events.push(event);
  });

  reporter.turnStarted(10);
  const turnId = events.find((event) => event.type === 'turn_started' && event.userMessageLength === 10);
  reporter.turnFinished(1, 0, 5);
  rejectHook(new Error('late failure'));
  await delay(0);

  const hookError = events.find((event) => event.type === 'hook_error');

  assert.equal(hookError?.type, 'hook_error');
  assert.equal(
    hookError?.type === 'hook_error' ? hookError.turnId : undefined,
    turnId?.type === 'turn_started' ? turnId.turnId : undefined,
  );
});

test('PluginRunner preserves the original turnId for async onEvent hook errors', async () => {
  const events: HarnessEvent[] = [];
  let rejectHook!: (error: Error) => void;
  const hookResult = new Promise<void>((_, reject) => {
    rejectHook = reject;
  });
  const plugins: HarnessPlugin[] = [
    {
      async onEvent() {
        await hookResult;
      },
      name: 'plugin-a',
    },
  ];

  const { reporter } = createPluginRunnerWithPlugins(plugins);
  reporter.subscribe((event) => {
    events.push(event);
  });

  reporter.turnStarted(10);
  const turnStartedEvent = events.at(-1);
  const originatingTurnId = turnStartedEvent?.type === 'turn_started' ? turnStartedEvent.turnId : undefined;
  reporter.turnFinished(1, 0, 5);
  rejectHook(new Error('late failure'));
  await delay(0);

  const hookError = events.find((event) => event.type === 'hook_error');

  assert.equal(hookError?.type, 'hook_error');
  assert.equal(hookError?.type === 'hook_error' ? hookError.turnId : undefined, originatingTurnId);
});

test('PluginRunner avoids recursive hook_error storms for the same plugin', async () => {
  const events: HarnessEvent[] = [];
  const plugins: HarnessPlugin[] = [
    {
      name: 'plugin-a',
      onEvent() {
        throw new Error('plugin-a onEvent failure');
      },
    },
  ];

  const { reporter } = createPluginRunnerWithPlugins(plugins);
  reporter.subscribe((event) => {
    events.push(event);
  });

  reporter.turnStarted(10);
  await delay(0);

  const hookErrors = events.filter((event) => event.type === 'hook_error');

  assert.equal(hookErrors.length, 1);
  assert.equal(hookErrors[0]?.type, 'hook_error');
  assert.equal(hookErrors[0]?.type === 'hook_error' ? hookErrors[0].pluginName : undefined, 'plugin-a');
  assert.equal(hookErrors[0]?.type === 'hook_error' ? hookErrors[0].hookName : undefined, 'onEvent');
});

test('PluginRunner subscribes only when at least one plugin defines onEvent', () => {
  const reporterWithoutEvents = createTestReporter();
  let subscribeCallsWithoutEvents = 0;
  const originalSubscribeWithoutEvents = reporterWithoutEvents.subscribe.bind(reporterWithoutEvents);
  reporterWithoutEvents.subscribe = ((listener) => {
    subscribeCallsWithoutEvents += 1;
    return originalSubscribeWithoutEvents(listener);
  }) as HarnessEventReporter['subscribe'];

  createPluginRunner({
    reporter: reporterWithoutEvents,
    plugins: [{ name: 'policy-only', beforeToolCall: () => ({ continue: true }) }],
    runId: 'run-without-events',
  });

  assert.equal(subscribeCallsWithoutEvents, 0);

  const reporterWithEvents = createTestReporter();
  let subscribeCallsWithEvents = 0;
  const originalSubscribeWithEvents = reporterWithEvents.subscribe.bind(reporterWithEvents);
  reporterWithEvents.subscribe = ((listener) => {
    subscribeCallsWithEvents += 1;
    return originalSubscribeWithEvents(listener);
  }) as HarnessEventReporter['subscribe'];

  createPluginRunner({
    reporter: reporterWithEvents,
    plugins: [{ name: 'event-plugin', onEvent: () => {} }],
    runId: 'run-with-events',
  });

  assert.equal(subscribeCallsWithEvents, 1);
});

test('createPluginRunner creates PluginRunner with correct options', () => {
  const plugins: HarnessPlugin[] = [
    {
      name: 'test-plugin',
    },
  ];

  const reporter = createTestReporter();
  const runner = createPluginRunner({
    reporter,
    plugins,
    runId: 'custom-run-id',
  });

  assert.ok(runner);
  assert.ok(runner instanceof PluginRunner);
});
