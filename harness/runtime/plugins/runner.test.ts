import assert from 'node:assert/strict';
import test from 'node:test';

import { HarnessEventReporter } from '../events/reporter.js';
import { RuntimeWorkTracker } from '../lifecycle.js';
import { createPluginRunner } from './runner.js';

function createRunner(plugins: Parameters<typeof createPluginRunner>[0]['plugins']) {
  const reporter = new HarnessEventReporter({
    getSessionId: () => 'session-1',
    providerName: 'fake',
  });
  const workTracker = new RuntimeWorkTracker();

  return {
    reporter,
    runner: createPluginRunner({
      plugins,
      reporter,
      runId: 'run-1',
      workTracker,
    }),
    workTracker,
  };
}

test('PluginRunner.runBeforeProviderCall executes in registration order and short-circuits on deny', async () => {
  const seen: string[] = [];
  const { runner } = createRunner([
    {
      beforeProviderCall() {
        seen.push('first');
        return { continue: true } as const;
      },
      name: 'first',
    },
    {
      beforeProviderCall() {
        seen.push('second');
        return { continue: false, reason: 'blocked' } as const;
      },
      name: 'second',
    },
    {
      beforeProviderCall() {
        seen.push('third');
        return { continue: true } as const;
      },
      name: 'third',
    },
  ]);

  const decision = await runner.runBeforeProviderCall({
    iteration: 1,
    messageCount: 1,
    messageCountsByRole: { assistant: 0, tool: 0, user: 1 },
    model: 'fake-model',
    providerName: 'fake',
    request: Object.freeze({ messages: Object.freeze([]), stream: false }),
    sessionId: 'session-1',
    toolDefinitionNames: [],
    turnId: 'turn-1',
  });

  assert.deepEqual(seen, ['first', 'second']);
  assert.deepEqual(decision, { continue: false, reason: 'blocked' });
});

test('PluginRunner.runBeforeToolExecution executes in registration order and fails closed on hook error', async () => {
  const seen: string[] = [];
  const events: string[] = [];
  const { reporter, runner } = createRunner([
    {
      beforeToolExecution() {
        seen.push('first');
        return { continue: true } as const;
      },
      name: 'first',
    },
    {
      beforeToolExecution() {
        seen.push('second');
        throw new Error('boom');
      },
      name: 'second',
    },
  ]);
  reporter.subscribe((event) => {
    events.push(event.type);
  });

  const decision = await runner.runBeforeToolExecution({
    iteration: 1,
    sessionId: 'session-1',
    tool: {
      input: {},
      originalName: 'workspace.read_file',
      publicName: 'workspace_read_file',
      rawCall: { id: 'call-1', input: {}, name: 'workspace_read_file' },
      sourceId: 'local-tools',
      toolCallId: 'call-1',
      toolId: 'local-tools:workspace.read_file',
    },
    turnId: 'turn-1',
  });

  assert.deepEqual(seen, ['first', 'second']);
  assert.deepEqual(decision, { continue: false, reason: 'Policy check failed' });
  assert.ok(events.includes('hook_error'));
});

test('PluginRunner delivers events to plugins and converts async failures into hook_error events', async () => {
  const received: string[] = [];
  const errors: string[] = [];
  const { reporter, workTracker } = createRunner([
    {
      name: 'listener',
      onEvent(event) {
        received.push(event.type);
      },
    },
    {
      name: 'broken-listener',
      async onEvent(event) {
        if (event.type === 'turn_started') {
          throw new Error('async plugin error');
        }
      },
    },
  ]);
  reporter.subscribe((event) => {
    if (event.type === 'hook_error') {
      errors.push(event.errorMessage);
    }
  });

  reporter.turnStarted(5);
  await workTracker.dispose();

  assert.ok(received.includes('turn_started'));
  assert.ok(errors.includes('Plugin hook failed.'));
});
