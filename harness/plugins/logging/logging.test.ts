import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import type { IterationStartedEvent, ProviderRequestedEvent, TurnFailedEvent } from '../../runtime/events/types.js';
import { createJsonlEventLoggingPlugin } from './jsonl.js';
import { createTextEventLoggingPlugin } from './text.js';

function createIterationEvent(index: number): IterationStartedEvent {
  return {
    iteration: 1,
    messageCount: index,
    sessionId: 'session-1',
    timestamp: `2026-03-31T12:00:${String(index).padStart(2, '0')}.000Z`,
    turnId: 'turn-1',
    type: 'iteration_started',
  };
}

function createTurnFailedEvent(): TurnFailedEvent {
  return {
    durationMs: 1,
    errorMessage: 'line1\nline2\rline3',
    errorType: 'runtime',
    iteration: 1,
    sessionId: 'session-1',
    timestamp: '2026-03-31T12:00:01.000Z',
    turnId: 'turn-1',
    type: 'turn_failed',
  };
}

function createProviderRequestedDebugEvent(): ProviderRequestedEvent {
  return {
    debugRequest: {
      messages: [
        { content: 'Retrieved context', role: 'user' },
        { content: 'living', role: 'user' },
      ],
      stream: false,
      systemPrompt: 'Answer briefly.',
    },
    iteration: 1,
    messageCount: 2,
    messageCountsByRole: { assistant: 0, tool: 0, user: 2 },
    model: 'fake-model',
    providerName: 'fake',
    sessionId: 'session-1',
    timestamp: '2026-03-31T12:00:02.000Z',
    toolDefinitionCount: 0,
    toolDefinitionNames: [],
    turnId: 'turn-1',
    type: 'provider_requested',
  };
}

const PLUGIN_CTX = {
  pluginName: 'test',
  runId: 'run-1',
  sessionId: 'session-1',
};

test('createJsonlEventLoggingPlugin writes one event per line', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'mersey-plugin-logger-'));

  try {
    const path = join(rootDir, 'runtime.jsonl');
    const plugin = createJsonlEventLoggingPlugin({ path });

    await plugin.onEvent?.(createIterationEvent(0), PLUGIN_CTX);

    const contents = await readFile(path, 'utf8');

    assert.equal(
      contents,
      '{"iteration":1,"messageCount":0,"sessionId":"session-1","timestamp":"2026-03-31T12:00:00.000Z","turnId":"turn-1","type":"iteration_started"}\n',
    );
  } finally {
    await rm(rootDir, { force: true, recursive: true });
  }
});

test('createTextEventLoggingPlugin writes human-readable summary lines', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'mersey-plugin-logger-'));

  try {
    const path = join(rootDir, 'runtime.log');
    const plugin = createTextEventLoggingPlugin({ path });

    await plugin.onEvent?.(createIterationEvent(0), PLUGIN_CTX);

    const contents = await readFile(path, 'utf8');

    assert.equal(
      contents,
      '2026-03-31T12:00:00.000Z iteration_started iteration=1 messageCount=0 sessionId=session-1 turnId=turn-1\n',
    );
  } finally {
    await rm(rootDir, { force: true, recursive: true });
  }
});

test('createTextEventLoggingPlugin escapes control characters onto one line', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'mersey-plugin-logger-'));

  try {
    const path = join(rootDir, 'runtime.log');
    const plugin = createTextEventLoggingPlugin({ path });

    await plugin.onEvent?.(createTurnFailedEvent(), PLUGIN_CTX);

    const contents = await readFile(path, 'utf8');
    const line = contents.trim();

    assert.equal(
      line,
      '2026-03-31T12:00:01.000Z turn_failed durationMs=1 errorMessage="line1\\nline2\\rline3" errorType=runtime iteration=1 sessionId=session-1 turnId=turn-1',
    );
    assert.equal(line.split('\n').length, 1);
  } finally {
    await rm(rootDir, { force: true, recursive: true });
  }
});

test('event logging plugins write debug provider request payloads when present', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'mersey-plugin-logger-'));

  try {
    const jsonlPath = join(rootDir, 'runtime.jsonl');
    const textPath = join(rootDir, 'runtime.log');
    const jsonlPlugin = createJsonlEventLoggingPlugin({ path: jsonlPath });
    const textPlugin = createTextEventLoggingPlugin({ path: textPath });
    const event = createProviderRequestedDebugEvent();

    await jsonlPlugin.onEvent?.(event, PLUGIN_CTX);
    await textPlugin.onEvent?.(event, PLUGIN_CTX);

    const jsonlContents = await readFile(jsonlPath, 'utf8');
    const textContents = await readFile(textPath, 'utf8');

    assert.match(
      jsonlContents,
      /"debugRequest":\{"messages":\[\{"content":"Retrieved context","role":"user"\},\{"content":"living","role":"user"\}\],"stream":false,"systemPrompt":"Answer briefly\."\}/,
    );
    assert.match(
      textContents,
      /debugRequest=\{"messages":\[\{"content":"Retrieved context","role":"user"\},\{"content":"living","role":"user"\}\],"stream":false,"systemPrompt":"Answer briefly\."\}/,
    );
  } finally {
    await rm(rootDir, { force: true, recursive: true });
  }
});

test('event logging plugins preserve write order under concurrent calls', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'mersey-plugin-logger-'));

  try {
    const jsonlPath = join(rootDir, 'runtime.jsonl');
    const textPath = join(rootDir, 'runtime.log');
    const jsonlPlugin = createJsonlEventLoggingPlugin({ path: jsonlPath });
    const textPlugin = createTextEventLoggingPlugin({ path: textPath });
    const events: IterationStartedEvent[] = Array.from({ length: 50 }, (_, index) => createIterationEvent(index));

    await Promise.all(events.map((event) => jsonlPlugin.onEvent?.(event, PLUGIN_CTX)));
    await Promise.all(events.map((event) => textPlugin.onEvent?.(event, PLUGIN_CTX)));

    const jsonlLines = (await readFile(jsonlPath, 'utf8')).trim().split('\n');
    const textLines = (await readFile(textPath, 'utf8')).trim().split('\n');

    assert.deepEqual(
      jsonlLines.map((line) => JSON.parse(line).messageCount),
      events.map((event) => event.messageCount),
    );
    assert.deepEqual(
      textLines.map((line) => Number(line.match(/messageCount=(\d+)/)?.[1])),
      events.map((event) => event.messageCount),
    );
  } finally {
    await rm(rootDir, { force: true, recursive: true });
  }
});

test('event logging plugins create parent directories on demand', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'mersey-plugin-logger-'));

  try {
    const path = join(rootDir, 'nested', 'runtime.log');
    const plugin = createTextEventLoggingPlugin({ path });

    await plugin.onEvent?.(createIterationEvent(1), PLUGIN_CTX);

    const contents = await readFile(path, 'utf8');

    assert.match(contents, /iteration_started/);
  } finally {
    await rm(rootDir, { force: true, recursive: true });
  }
});
