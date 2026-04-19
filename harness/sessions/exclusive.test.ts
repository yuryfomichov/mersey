import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import { SessionTurnLockMap } from './exclusive.js';

test('SessionTurnLockMap allows reentrant work while a lock is active', async () => {
  const locks = new SessionTurnLockMap();
  const steps: string[] = [];

  await locks.runExclusive('shared-session', async () => {
    steps.push('outer-start');

    await locks.runExclusive('shared-session', async () => {
      steps.push('inner');
    });

    steps.push('outer-end');
  });

  assert.deepEqual(steps, ['outer-start', 'inner', 'outer-end']);
});

test('SessionTurnLockMap does not let detached async work bypass later lock holders', async () => {
  const locks = new SessionTurnLockMap();
  const started: string[] = [];
  const completed: string[] = [];
  let releaseSecond!: () => void;
  let detachedRun: Promise<void> | null = null;
  let waitForDetachedSchedule!: () => void;
  const secondRelease = new Promise<void>((resolve) => {
    releaseSecond = resolve;
  });
  const detachedScheduled = new Promise<void>((resolve) => {
    waitForDetachedSchedule = resolve;
  });

  await locks.runExclusive('shared-session', async () => {
    started.push('outer');

    setTimeout(() => {
      detachedRun = locks.runExclusive('shared-session', async () => {
        started.push('detached');
        completed.push('detached');
      });
      waitForDetachedSchedule();
    }, 0);

    completed.push('outer');
  });

  const secondRun = locks.runExclusive('shared-session', async () => {
    started.push('second');
    await secondRelease;
    completed.push('second');
  });

  await detachedScheduled;
  await delay(20);

  assert.deepEqual(started, ['outer', 'second']);

  releaseSecond();
  await secondRun;
  await detachedRun;

  assert.deepEqual(completed, ['outer', 'second', 'detached']);
});
