import assert from 'node:assert/strict';
import test from 'node:test';

import type { HarnessRuntimeTrace } from '../logger/types.js';
import { createEmptyModelUsage, type ModelToolCall } from '../models/types.js';
import { HarnessObserver } from './observer.js';
import type { HarnessEvent } from './types.js';

function createToolCall(input: Record<string, unknown>): ModelToolCall {
  return {
    id: 'call-1',
    input,
    name: 'read_file',
  };
}

test('HarnessObserver emits session_started and event delivery traces', async () => {
  const traces: HarnessRuntimeTrace[] = [];
  const observer = new HarnessObserver({
    debug: false,
    getSessionId: () => 'session-1',
    logger: {
      log(trace): void {
        traces.push(trace);
      },
    },
    providerName: 'fake',
  });
  observer.sessionStarted();

  observer.subscribe(() => {
    throw new Error('listener boom');
  });

  observer.turnStarted(5);
  observer.turnFinished(1, 0, 5);
  await Promise.resolve();

  assert.ok(traces.some((trace) => trace.type === 'session_started'));
  assert.ok(traces.some((trace) => trace.type === 'event_emitted'));
  assert.ok(traces.some((trace) => trace.type === 'listener_failed'));
});

test('HarnessObserver publishes safe tool args without debug args by default', () => {
  const events: HarnessEvent[] = [];
  const observer = new HarnessObserver({
    getSessionId: () => 'session-1',
    logger: undefined,
    providerName: 'fake',
  });

  observer.subscribe((event) => {
    events.push(event);
  });

  observer.turnStarted(5);
  observer.toolRequested(1, createToolCall({ path: 'notes/note.txt' }));

  const event = events[1];

  assert.equal(event?.type, 'tool_requested');
  assert.deepEqual(event && event.type === 'tool_requested' ? event.debugArgs : undefined, undefined);
  assert.equal(event && event.type === 'tool_requested' ? event.safeArgs.path?.basename : undefined, 'note.txt');
});

test('HarnessObserver includes debug tool args when debug is enabled', () => {
  const traces: HarnessRuntimeTrace[] = [];
  const events: HarnessEvent[] = [];
  const observer = new HarnessObserver({
    debug: true,
    getSessionId: () => 'session-1',
    logger: {
      log(trace): void {
        traces.push(trace);
      },
    },
    providerName: 'fake',
  });

  observer.subscribe((event) => {
    events.push(event);
  });

  observer.turnStarted(5);
  observer.toolRequested(1, createToolCall({ args: ['status'], command: 'git', cwd: '.' }));
  observer.toolStarted(1, createToolCall({ args: ['status'], command: 'git', cwd: '.' }));

  const toolRequestedEvent = events[1];
  const toolTrace = traces.find((trace) => trace.type === 'tool_execution_started');

  assert.deepEqual(
    toolRequestedEvent && toolRequestedEvent.type === 'tool_requested' ? toolRequestedEvent.debugArgs : undefined,
    {
      args: ['status'],
      command: 'git',
      cwd: '.',
    },
  );
  assert.deepEqual((toolTrace?.detail.debugArgs as Record<string, unknown> | undefined) ?? undefined, {
    args: ['status'],
    command: 'git',
    cwd: '.',
  });
});

test('HarnessObserver sanitizes provider failures in turn_failed events', () => {
  const events: HarnessEvent[] = [];
  const observer = new HarnessObserver({
    getSessionId: () => 'session-1',
    logger: undefined,
    providerName: 'fake',
  });

  observer.subscribe((event) => {
    events.push(event);
  });

  observer.turnStarted('top secret prompt'.length);
  observer.turnFailed(1, 'provider', new Error('provider secret: leaked prompt contents'));

  const event = events.at(-1);

  assert.equal(event?.type, 'turn_failed');
  assert.equal(event && event.type === 'turn_failed' ? event.errorType : undefined, 'provider');
  assert.equal(event && event.type === 'turn_failed' ? event.errorMessage : undefined, 'Provider request failed.');
  assert.doesNotMatch(JSON.stringify(events), /top secret prompt/);
  assert.doesNotMatch(JSON.stringify(events), /leaked prompt contents/);
});

test('HarnessObserver marks fallback provider responses in provider_responded events', () => {
  const events: HarnessEvent[] = [];
  const observer = new HarnessObserver({
    getSessionId: () => 'session-1',
    logger: undefined,
    providerName: 'fake',
  });

  observer.subscribe((event) => {
    events.push(event);
  });

  observer.turnStarted(5);
  observer.providerResponded(
    1,
    { model: 'fake-model', name: 'fake' },
    { text: '', usage: createEmptyModelUsage() },
    12,
  );

  const event = events[1];

  assert.equal(event?.type, 'provider_responded');
  assert.equal(event && event.type === 'provider_responded' ? event.usedFallbackText : undefined, true);
});

test('HarnessObserver sanitizes hook_error messages', () => {
  const events: HarnessEvent[] = [];
  const observer = new HarnessObserver({
    getSessionId: () => 'session-1',
    logger: undefined,
    providerName: 'fake',
  });

  observer.subscribe((event) => {
    events.push(event);
  });

  observer.turnStarted(5);
  observer.hookError('plugin-a', 'onEvent', new Error('sensitive detail'));

  const event = events.at(-1);

  assert.equal(event?.type, 'hook_error');
  assert.equal(event && event.type === 'hook_error' ? event.errorMessage : undefined, 'Plugin hook failed.');
});
