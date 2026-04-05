import assert from 'node:assert/strict';
import test from 'node:test';

import { createEmptyModelUsage, type ModelToolCall } from '../models/types.js';
import { HarnessEventReporter } from './reporter.js';
import type { HarnessEvent } from './types.js';

function createToolCall(input: Record<string, unknown>): ModelToolCall {
  return {
    id: 'call-1',
    input,
    name: 'read_file',
  };
}

test('HarnessEventReporter emits session_started only once', async () => {
  const events: HarnessEvent[] = [];
  const reporter = new HarnessEventReporter({
    debug: false,
    getSessionId: () => 'session-1',
    providerName: 'fake',
  });

  reporter.subscribe((event) => {
    events.push(event);
  });

  reporter.sessionStarted();
  reporter.sessionStarted();
  reporter.turnStarted(5);
  reporter.turnFinished(1, 0, 5);
  await Promise.resolve();

  assert.equal(events.filter((event) => event.type === 'session_started').length, 1);
});

test('HarnessEventReporter publishes safe tool args without debug args by default', () => {
  const events: HarnessEvent[] = [];
  const reporter = new HarnessEventReporter({
    getSessionId: () => 'session-1',
    providerName: 'fake',
  });

  reporter.subscribe((event) => {
    events.push(event);
  });

  reporter.turnStarted(5);
  reporter.toolRequested(1, createToolCall({ path: 'notes/note.txt' }));

  const event = events[1];

  assert.equal(event?.type, 'tool_requested');
  assert.deepEqual(event && event.type === 'tool_requested' ? event.debugArgs : undefined, undefined);
  assert.equal(event && event.type === 'tool_requested' ? event.safeArgs.path?.basename : undefined, 'note.txt');
});

test('HarnessEventReporter includes debug tool args when debug is enabled', () => {
  const events: HarnessEvent[] = [];
  const reporter = new HarnessEventReporter({
    debug: true,
    getSessionId: () => 'session-1',
    providerName: 'fake',
  });

  reporter.subscribe((event) => {
    events.push(event);
  });

  reporter.turnStarted(5);
  reporter.toolRequested(1, createToolCall({ args: ['status'], command: 'git', cwd: '.' }));
  reporter.toolStarted(1, createToolCall({ args: ['status'], command: 'git', cwd: '.' }));

  const toolRequestedEvent = events[1];

  assert.deepEqual(
    toolRequestedEvent && toolRequestedEvent.type === 'tool_requested' ? toolRequestedEvent.debugArgs : undefined,
    {
      args: ['status'],
      command: 'git',
      cwd: '.',
    },
  );
});

test('HarnessEventReporter sanitizes provider failures in turn_failed events', () => {
  const events: HarnessEvent[] = [];
  const reporter = new HarnessEventReporter({
    getSessionId: () => 'session-1',
    providerName: 'fake',
  });

  reporter.subscribe((event) => {
    events.push(event);
  });

  reporter.turnStarted('top secret prompt'.length);
  reporter.turnFailed(1, 'provider', new Error('provider secret: leaked prompt contents'));

  const event = events.at(-1);

  assert.equal(event?.type, 'turn_failed');
  assert.equal(event && event.type === 'turn_failed' ? event.errorType : undefined, 'provider');
  assert.equal(event && event.type === 'turn_failed' ? event.errorMessage : undefined, 'Provider request failed.');
  assert.doesNotMatch(JSON.stringify(events), /top secret prompt/);
  assert.doesNotMatch(JSON.stringify(events), /leaked prompt contents/);
});

test('HarnessEventReporter marks fallback provider responses in provider_responded events', () => {
  const events: HarnessEvent[] = [];
  const reporter = new HarnessEventReporter({
    getSessionId: () => 'session-1',
    providerName: 'fake',
  });

  reporter.subscribe((event) => {
    events.push(event);
  });

  reporter.turnStarted(5);
  reporter.providerResponded(
    1,
    { model: 'fake-model', name: 'fake' },
    { text: '', usage: createEmptyModelUsage() },
    12,
  );

  const event = events[1];

  assert.equal(event?.type, 'provider_responded');
  assert.equal(event && event.type === 'provider_responded' ? event.usedFallbackText : undefined, true);
});

test('HarnessEventReporter sanitizes hook_error messages', () => {
  const events: HarnessEvent[] = [];
  const reporter = new HarnessEventReporter({
    getSessionId: () => 'session-1',
    providerName: 'fake',
  });

  reporter.subscribe((event) => {
    events.push(event);
  });

  reporter.turnStarted(5);
  reporter.hookError('plugin-a', 'onEvent', new Error('sensitive detail'));

  const event = events.at(-1);

  assert.equal(event?.type, 'hook_error');
  assert.equal(event && event.type === 'hook_error' ? event.errorMessage : undefined, 'Plugin hook failed.');
});
