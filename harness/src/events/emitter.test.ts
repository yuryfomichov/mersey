import assert from 'node:assert/strict';
import test from 'node:test';

import { HarnessEventEmitter } from './emitter.js';
import type { HarnessEvent, TurnFinishedEvent } from './types.js';

function createEvent(): TurnFinishedEvent {
  return {
    durationMs: 12,
    finalAssistantLength: 5,
    sessionId: 'session-1',
    timestamp: '2026-03-29T00:00:00.000Z',
    totalIterations: 1,
    totalToolCalls: 0,
    turnId: 'turn-1',
    type: 'turn_finished',
  };
}

test('HarnessEventEmitter snapshots events before delivery', () => {
  const emitter = new HarnessEventEmitter();
  const event = createEvent();
  const seenEvents: HarnessEvent[] = [];

  emitter.subscribe((receivedEvent) => {
    seenEvents.push(receivedEvent);
  });

  emitter.publish(event);
  event.turnId = 'mutated-turn';

  const receivedEvent = seenEvents[0] as TurnFinishedEvent | undefined;

  assert.ok(receivedEvent);
  assert.equal(receivedEvent.type, 'turn_finished');

  assert.equal(receivedEvent.turnId, 'turn-1');
  assert.throws(() => {
    receivedEvent.totalIterations = 3;
  });
});

test('HarnessEventEmitter emits session events without turnId', () => {
  const turnFinishedEvent = createEvent();
  const seenEvents: HarnessEvent[] = [];
  const emitter = new HarnessEventEmitter();

  emitter.subscribe((receivedEvent) => {
    seenEvents.push(receivedEvent);
  });

  emitter.publish({
    debug: false,
    providerName: 'fake',
    runId: 'run-1',
    sessionId: 'session-1',
    timestamp: '2026-03-29T00:00:00.000Z',
    type: 'session_started',
  });
  emitter.publish(turnFinishedEvent);
  turnFinishedEvent.turnId = 'mutated-turn';

  assert.equal(seenEvents[0]?.type, 'session_started');
  assert.equal('turnId' in (seenEvents[0] ?? {}), false);

  const receivedTurnFinished = seenEvents[1] as TurnFinishedEvent | undefined;
  assert.ok(receivedTurnFinished);
  assert.equal(receivedTurnFinished.turnId, 'turn-1');
  assert.throws(() => {
    receivedTurnFinished.turnId = 'changed';
  });
});

test('HarnessEventEmitter unsubscribes listeners and swallows listener failures', async () => {
  const emitter = new HarnessEventEmitter();
  let callCount = 0;
  const unsubscribe = emitter.subscribe(() => {
    callCount += 1;
  });

  emitter.subscribe(() => {
    throw new Error('listener boom');
  });

  emitter.publish(createEvent());
  unsubscribe();
  emitter.publish(createEvent());

  await Promise.resolve();

  assert.equal(callCount, 1);
});

test('HarnessEventEmitter protects listeners from event mutation by other listeners', () => {
  const emitter = new HarnessEventEmitter();
  let mutationThrew = false;
  let seenTurnId: string | undefined;

  emitter.subscribe((event) => {
    if (event.type === 'session_started') {
      return;
    }

    try {
      event.turnId = 'mutated-turn';
    } catch {
      mutationThrew = true;
    }
  });

  emitter.subscribe((event) => {
    if (event.type !== 'session_started') {
      seenTurnId = event.turnId;
    }
  });

  emitter.publish(createEvent());

  assert.equal(mutationThrew, true);
  assert.equal(seenTurnId, 'turn-1');
});

test('HarnessEventEmitter does not crash on malformed payloads at runtime', () => {
  const emitter = new HarnessEventEmitter();
  let callCount = 0;

  emitter.subscribe(() => {
    callCount += 1;
  });

  assert.doesNotThrow(() => {
    emitter.publish({
      durationMs: 3,
      finalAssistantLength: 1,
      sessionId: 'session-1',
      timestamp: '2026-03-29T00:00:00.000Z',
      totalIterations: 1,
      totalToolCalls: 0,
      type: 'turn_finished',
    } as HarnessEvent);
  });

  assert.equal(callCount, 1);
});
