import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createJsonlFileLogger, createTextFileLogger } from './logger/index.js';

test('createJsonlFileLogger writes one trace per line', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'mersey-logger-'));

  try {
    const path = join(rootDir, 'runtime.jsonl');
    const logger = createJsonlFileLogger({ path });

    await logger.log({
      detail: { model: 'fake-model', toolCallCount: 1 },
      timestamp: '2026-03-31T12:00:00.000Z',
      type: 'provider_response_finished',
    });

    const contents = await readFile(path, 'utf8');

    assert.equal(
      contents,
      '{"detail":{"model":"fake-model","toolCallCount":1},"timestamp":"2026-03-31T12:00:00.000Z","type":"provider_response_finished"}\n',
    );
  } finally {
    await rm(rootDir, { force: true, recursive: true });
  }
});

test('createTextFileLogger writes human-readable summary lines', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'mersey-logger-'));

  try {
    const path = join(rootDir, 'runtime.log');
    const logger = createTextFileLogger({ path });

    await logger.log({
      detail: { durationMs: 42, model: 'fake-model', toolCallCount: 1 },
      timestamp: '2026-03-31T12:00:00.000Z',
      type: 'provider_response_finished',
    });

    const contents = await readFile(path, 'utf8');

    assert.equal(
      contents,
      '2026-03-31T12:00:00.000Z provider_response_finished durationMs=42 model=fake-model toolCallCount=1\n',
    );
  } finally {
    await rm(rootDir, { force: true, recursive: true });
  }
});

test('createTextFileLogger escapes control characters onto one line', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'mersey-logger-'));

  try {
    const path = join(rootDir, 'runtime.log');
    const logger = createTextFileLogger({ path });

    await logger.log({
      detail: { note: 'line1\nline2\rline3' },
      timestamp: '2026-03-31T12:00:00.000Z',
      type: 'event_emitted',
    });

    const contents = await readFile(path, 'utf8');

    assert.equal(contents, '2026-03-31T12:00:00.000Z event_emitted note="line1\\nline2\\rline3"\n');
    assert.equal(contents.trim().split('\n').length, 1);
  } finally {
    await rm(rootDir, { force: true, recursive: true });
  }
});

test('file loggers preserve write order under concurrent calls', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'mersey-logger-'));

  try {
    const jsonlPath = join(rootDir, 'runtime.jsonl');
    const textPath = join(rootDir, 'runtime.log');
    const jsonlLogger = createJsonlFileLogger({ path: jsonlPath });
    const textLogger = createTextFileLogger({ path: textPath });
    const events = Array.from({ length: 200 }, (_, index) => ({
      detail: { index },
      timestamp: `2026-03-31T12:00:${String(index).padStart(2, '0')}.000Z`,
      type: 'event_emitted' as const,
    }));

    await Promise.all(events.map((event) => jsonlLogger.log(event)));
    await Promise.all(events.map((event) => textLogger.log(event)));

    const jsonlLines = (await readFile(jsonlPath, 'utf8')).trim().split('\n');
    const textLines = (await readFile(textPath, 'utf8')).trim().split('\n');

    assert.deepEqual(
      jsonlLines.map((line) => JSON.parse(line).detail.index),
      events.map((event) => event.detail.index),
    );
    assert.deepEqual(
      textLines.map((line) => Number(line.match(/index=(\d+)/)?.[1])),
      events.map((event) => event.detail.index),
    );
  } finally {
    await rm(rootDir, { force: true, recursive: true });
  }
});
