import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import { createFanoutLogger } from './fanout.js';
import type { HarnessRuntimeTrace } from './types.js';

function createTrace(): HarnessRuntimeTrace {
  return {
    detail: { sessionId: 'session-1' },
    timestamp: '2026-03-31T12:00:00.000Z',
    type: 'session_started',
  };
}

test('createFanoutLogger fans out traces to multiple loggers and isolates failures', () => {
  const recordedTraces: HarnessRuntimeTrace[] = [];
  const logger = createFanoutLogger([
    {
      log(trace): void {
        recordedTraces.push(trace);
      },
    },
    {
      log(): void {
        throw new Error('logger failed');
      },
    },
  ]);

  logger?.log(createTrace());

  assert.equal(recordedTraces.length, 1);
  assert.equal(recordedTraces[0]?.type, 'session_started');
});

test('createFanoutLogger does not wait for async loggers', async () => {
  const logger = createFanoutLogger([
    {
      log(): Promise<void> {
        return new Promise(() => {});
      },
    },
  ]);

  const completed = await Promise.race([
    Promise.resolve(logger?.log(createTrace())).then(() => true),
    delay(50).then(() => false),
  ]);

  assert.equal(completed, true);
});
