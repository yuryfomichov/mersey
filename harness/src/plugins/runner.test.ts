import assert from 'node:assert/strict';
import test from 'node:test';

import { HarnessObserver } from '../events/observer.js';
import { PluginRunner, createPluginRunner } from './runner.js';
import type { BeforeProviderCallContext, BeforeToolCallContext, HarnessPlugin } from './types.js';

function createTestObserver(): HarnessObserver {
  return new HarnessObserver({
    getSessionId: () => 'test-session',
    logger: undefined,
    providerName: 'test-provider',
  });
}

function createPluginRunnerWithPlugins(plugins: HarnessPlugin[]): { observer: HarnessObserver; runner: PluginRunner } {
  const observer = createTestObserver();
  const runner = createPluginRunner({
    observer,
    plugins,
    runId: 'test-run-id',
  });
  return { observer, runner };
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
  const ctx: BeforeProviderCallContext = {
    iteration: 1,
    messageCount: 1,
    messageCountsByRole: { user: 1, assistant: 0, tool: 0 },
    model: 'test-model',
    providerName: 'test-provider',
    sessionId: 'test-session',
    toolDefinitionNames: [],
    turnId: 'test-turn',
  };

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
  const ctx: BeforeProviderCallContext = {
    iteration: 1,
    messageCount: 1,
    messageCountsByRole: { user: 1, assistant: 0, tool: 0 },
    model: 'test-model',
    providerName: 'test-provider',
    sessionId: 'test-session',
    toolDefinitionNames: [],
    turnId: 'test-turn',
  };

  const decision = await runner.runBeforeProviderCall(ctx);

  assert.deepEqual(callOrder, ['plugin-a']);
  assert.equal(decision.continue, false);
  assert.equal(decision.reason, 'denied by plugin-a');
});

test('PluginRunner.runBeforeProviderCall fails closed on hook error', async () => {
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

  const { runner } = createPluginRunnerWithPlugins(plugins);
  const ctx: BeforeProviderCallContext = {
    iteration: 1,
    messageCount: 1,
    messageCountsByRole: { user: 1, assistant: 0, tool: 0 },
    model: 'test-model',
    providerName: 'test-provider',
    sessionId: 'test-session',
    toolDefinitionNames: [],
    turnId: 'test-turn',
  };

  const decision = await runner.runBeforeProviderCall(ctx);

  assert.equal(decision.continue, false);
  assert.equal(decision.reason, 'Policy check failed');
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

  const { runner } = createPluginRunnerWithPlugins(plugins);
  const ctx: BeforeToolCallContext = {
    iteration: 1,
    sessionId: 'test-session',
    toolCall: { id: 'call-1', input: {}, name: 'test_tool' },
    turnId: 'test-turn',
  };

  const decision = await runner.runBeforeToolCall(ctx);

  assert.equal(decision.continue, false);
  assert.equal(decision.reason, 'Policy check failed');
});

test('PluginRunner delivers events to all plugins via observer subscription', async () => {
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

  const { observer } = createPluginRunnerWithPlugins(plugins);
  observer.turnStarted(10);

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

  const { observer } = createPluginRunnerWithPlugins(plugins);

  await assert.doesNotReject(
    new Promise<void>((resolve) => {
      observer.subscribe(() => {
        resolve();
      });
      observer.turnStarted(10);
    }),
  );
});

test('createPluginRunner creates PluginRunner with correct options', () => {
  const plugins: HarnessPlugin[] = [
    {
      name: 'test-plugin',
    },
  ];

  const observer = createTestObserver();
  const runner = createPluginRunner({
    observer,
    plugins,
    runId: 'custom-run-id',
  });

  assert.ok(runner);
  assert.ok(runner instanceof PluginRunner);
});
