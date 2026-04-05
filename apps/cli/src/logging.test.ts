import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createCliLoggingPlugins, getCliLogPaths } from './logging.js';

test('getCliLogPaths uses the session id under logs/', () => {
  const logPaths = getCliLogPaths('session-123', '/workspace/project');

  assert.deepEqual(logPaths, {
    jsonlPath: '/workspace/project/logs/session-123.jsonl',
    logsDir: '/workspace/project/logs',
    textPath: '/workspace/project/logs/session-123.log',
  });
});

test('createCliLoggingPlugins creates both log files under logs/', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'mersey-cli-'));

  try {
    const { logPaths, plugins } = await createCliLoggingPlugins('session-456', cwd);

    assert.equal(await readFile(logPaths.jsonlPath, 'utf8'), '');
    assert.equal(await readFile(logPaths.textPath, 'utf8'), '');

    await Promise.all(
      plugins.map((plugin) =>
        plugin.onEvent?.(
          {
            debug: false,
            providerName: 'fake',
            runId: 'run-1',
            sessionId: 'session-456',
            timestamp: '2026-03-31T12:00:00.000Z',
            type: 'session_started',
          },
          {
            pluginName: plugin.name,
            runId: 'run-1',
            sessionId: 'session-456',
          },
        ),
      ),
    );

    assert.equal(
      await readFile(logPaths.jsonlPath, 'utf8'),
      '{"debug":false,"providerName":"fake","runId":"run-1","sessionId":"session-456","timestamp":"2026-03-31T12:00:00.000Z","type":"session_started"}\n',
    );
    assert.equal(
      await readFile(logPaths.textPath, 'utf8'),
      '2026-03-31T12:00:00.000Z session_started debug=false providerName=fake runId=run-1 sessionId=session-456\n',
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
