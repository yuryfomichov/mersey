import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createCliLoggers, getCliLogPaths, writeCliRunMarker } from './logging.js';

test('getCliLogPaths uses the session id under logs/', () => {
  const logPaths = getCliLogPaths('session-123', '/workspace/project');

  assert.deepEqual(logPaths, {
    jsonlPath: '/workspace/project/logs/session-123.jsonl',
    logsDir: '/workspace/project/logs',
    textPath: '/workspace/project/logs/session-123.log',
  });
});

test('createCliLoggers creates both log files under logs/', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'mersey-cli-'));

  try {
    const { logPaths, loggers } = await createCliLoggers('session-456', cwd);

    assert.equal(await readFile(logPaths.jsonlPath, 'utf8'), '');
    assert.equal(await readFile(logPaths.textPath, 'utf8'), '');

    await Promise.all(
      loggers.map((logger) =>
        logger.log({
          detail: { sessionId: 'session-456' },
          timestamp: '2026-03-31T12:00:00.000Z',
          type: 'event_emitted',
        }),
      ),
    );

    assert.equal(await readFile(logPaths.jsonlPath, 'utf8'), '{"detail":{"sessionId":"session-456"},"timestamp":"2026-03-31T12:00:00.000Z","type":"event_emitted"}\n');
    assert.equal(
      await readFile(logPaths.textPath, 'utf8'),
      '2026-03-31T12:00:00.000Z event_emitted sessionId=session-456\n',
    );
  } finally {
    await rm(cwd, { force: true, recursive: true });
  }
});

test('getCliLogPaths rejects traversal-style session ids', () => {
  assert.throws(() => getCliLogPaths('../../outside', '/workspace/project'), /Invalid session id/);
});

test('getCliLogPaths does not echo the raw invalid session id in the error', () => {
  assert.throws(
    () => getCliLogPaths('bad\nvalue', '/workspace/project'),
    (error: unknown) => error instanceof Error && error.message === 'Invalid session id.',
  );
});

test('writeCliRunMarker appends a session_started marker to both log files', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'mersey-cli-'));

  try {
    const { logPaths, loggers } = await createCliLoggers('session-789', cwd);
    const marker = await writeCliRunMarker(loggers, {
      debug: true,
      provider: 'openai',
      sessionId: 'session-789',
    });

    const jsonlContents = await readFile(logPaths.jsonlPath, 'utf8');
    const textContents = await readFile(logPaths.textPath, 'utf8');

    assert.match(jsonlContents, new RegExp(`"type":"session_started"`));
    assert.match(jsonlContents, new RegExp(`"runId":"${marker.runId}"`));
    assert.match(textContents, /session_started/);
    assert.match(textContents, new RegExp(`runId=${marker.runId}`));
  } finally {
    await rm(cwd, { force: true, recursive: true });
  }
});

test('writeCliRunMarker swallows individual logger failures', async () => {
  const events: Array<Record<string, unknown>> = [];

  const marker = await writeCliRunMarker(
    [
      {
        log(event): void {
          events.push(event as Record<string, unknown>);
        },
      },
      {
        async log(): Promise<void> {
          throw new Error('logger failed');
        },
      },
    ],
    {
      debug: false,
      provider: 'fake',
      sessionId: 'session-999',
    },
  );

  assert.equal(events.length, 1);
  assert.equal(events[0]?.type, 'session_started');
  assert.equal(marker.sessionId, 'session-999');
});
