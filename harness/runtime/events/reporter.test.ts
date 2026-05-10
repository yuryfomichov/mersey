import assert from 'node:assert/strict';
import test from 'node:test';

import { createEmptyModelUsage } from '../models/types.js';
import type { ResolvedToolCall } from '../tools/catalog.js';
import { HarnessEventReporter } from './reporter.js';
import type { HarnessEvent } from './types.js';

function createToolCall(input: Record<string, unknown>): ResolvedToolCall {
  return {
    input,
    originalName: 'read_file',
    publicName: 'read_file',
    rawCall: {
      id: 'call-1',
      input,
      name: 'read_file',
    },
    sourceId: 'local-tools',
    toolCallId: 'call-1',
    toolId: 'local-tools:read_file',
  };
}

test('HarnessEventReporter omits debug provider request payloads by default', () => {
  const events: HarnessEvent[] = [];
  const reporter = new HarnessEventReporter({
    getSessionId: () => 'session-1',
    providerName: 'fake',
  });

  reporter.subscribe((event) => {
    events.push(event);
  });

  reporter.turnStarted(5);
  reporter.providerRequested(
    1,
    {
      messages: [{ content: 'hello', role: 'user' }],
      stream: false,
      systemPrompt: 'You are helpful.',
      tools: [{ description: 'Read a file', inputSchema: { type: 'object' }, name: 'read_file' }],
    },
    { model: 'fake-model', name: 'fake' },
  );

  const event = events[1];

  assert.equal(event?.type, 'provider_requested');
  assert.deepEqual(event && event.type === 'provider_requested' ? event.debugRequest : undefined, undefined);
});

test('HarnessEventReporter includes final provider request payloads when debug is enabled', () => {
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
  reporter.providerRequested(
    1,
    {
      messages: [
        { content: 'Retrieved context', role: 'user' },
        { content: 'hello', role: 'user' },
      ],
      stream: false,
      systemPrompt: 'You are helpful.',
      tools: [{ description: 'Read a file', inputSchema: { properties: {}, type: 'object' }, name: 'read_file' }],
    },
    { model: 'fake-model', name: 'fake' },
  );

  const event = events[1];

  assert.equal(event?.type, 'provider_requested');
  assert.deepEqual(event && event.type === 'provider_requested' ? event.debugRequest : undefined, {
    messages: [
      { content: 'Retrieved context', role: 'user' },
      { content: 'hello', role: 'user' },
    ],
    stream: false,
    systemPrompt: 'You are helpful.',
    tools: [{ description: 'Read a file', inputSchema: { properties: {}, type: 'object' }, name: 'read_file' }],
  });
});

test('HarnessEventReporter sanitizes debug provider request payloads for event delivery', () => {
  const events: HarnessEvent[] = [];
  const reporter = new HarnessEventReporter({
    debug: true,
    getSessionId: () => 'session-1',
    providerName: 'fake',
  });

  const circularSchema: Record<string, unknown> = { type: 'object' };
  circularSchema.self = circularSchema;
  const sharedValue = { kind: 'shared' };

  reporter.subscribe((event) => {
    events.push(event);
  });

  reporter.turnStarted(5);
  reporter.providerRequested(
    1,
    {
      messages: [
        {
          content: 'tool output',
          metadata: { callback: () => 'not cloneable', first: sharedValue, second: sharedValue },
          parts: [{ text: 'tool output', type: 'text' }],
          publicName: 'example_tool',
          role: 'tool',
          toolCallId: 'call-1',
          toolId: 'local-tools:example_tool',
        },
      ],
      stream: false,
      tools: [{ description: 'Read a file', inputSchema: circularSchema as { type: 'object' }, name: 'read_file' }],
    },
    { model: 'fake-model', name: 'fake' },
  );

  const event = events[1];

  assert.equal(event?.type, 'provider_requested');
  assert.deepEqual(event && event.type === 'provider_requested' ? event.debugRequest : undefined, {
    messages: [
      {
        content: 'tool output',
        metadata: { callback: '[function]', first: { kind: 'shared' }, second: { kind: 'shared' } },
        parts: [{ text: 'tool output', type: 'text' }],
        publicName: 'example_tool',
        role: 'tool',
        toolCallId: 'call-1',
        toolId: 'local-tools:example_tool',
      },
    ],
    stream: false,
    tools: [{ description: 'Read a file', inputSchema: { self: '[circular]', type: 'object' }, name: 'read_file' }],
  });
  assert.doesNotThrow(() => JSON.stringify(event));
});

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

test('HarnessEventReporter reports cyclic JSON tool parts without throwing', () => {
  const events: HarnessEvent[] = [];
  const reporter = new HarnessEventReporter({
    getSessionId: () => 'session-1',
    providerName: 'fake',
  });
  const value: Record<string, unknown> = { name: 'root' };
  value.self = value;

  reporter.subscribe((event) => {
    events.push(event);
  });

  reporter.turnStarted(5);
  assert.doesNotThrow(() => {
    reporter.toolFinished(
      1,
      createToolCall({ path: 'notes/note.txt' }),
      {
        parts: [{ type: 'json', value }],
      },
      12,
    );
  });

  const event = events.at(-1);
  assert.equal(event?.type, 'tool_finished');
  assert.equal(event && event.type === 'tool_finished' ? event.resultContentLength > 0 : false, true);
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

test('HarnessEventReporter respects hook_error session and turn overrides', () => {
  const events: HarnessEvent[] = [];
  const reporter = new HarnessEventReporter({
    getSessionId: () => 'session-1',
    providerName: 'fake',
  });

  reporter.subscribe((event) => {
    events.push(event);
  });

  reporter.hookError('plugin-a', 'afterTurnCommitted', new Error('boom'), {
    sessionId: 'session-override',
    turnId: 'turn-override',
  });

  const event = events.at(-1);

  assert.equal(event?.type, 'hook_error');
  assert.equal(event && event.type === 'hook_error' ? event.sessionId : undefined, 'session-override');
  assert.equal(event && event.type === 'hook_error' ? event.turnId : undefined, 'turn-override');
});
