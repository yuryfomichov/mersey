import assert from 'node:assert/strict';
import test from 'node:test';

import type { HarnessRuntimeTrace } from '../logger/types.js';
import { HarnessObserver } from './observer.js';
test('HarnessObserver emits session_started and event delivery traces', async () => {
  const traces: HarnessRuntimeTrace[] = [];
  const observer = new HarnessObserver({
    debug: false,
    logger: {
      log(trace): void {
        traces.push(trace);
      },
    },
    providerName: 'fake',
    sessionId: 'session-1',
    stream: true,
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
