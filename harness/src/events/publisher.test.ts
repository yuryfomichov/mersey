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

test('HarnessEventPublisher snapshots events before delivery', () => {
  const publisher = new HarnessEventEmitter();
  const event = createEvent();
  const seenEvents: HarnessEvent[] = [];

  publisher.subscribe((receivedEvent) => {
    seenEvents.push(receivedEvent);
  });

  publisher.publish(event);
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
  const publisher = new HarnessEventEmitter();

  publisher.subscribe((receivedEvent) => {
    seenEvents.push(receivedEvent);
  });

  publisher.publish({
    debug: false,
    providerName: 'fake',
    runId: 'run-1',
    sessionId: 'session-1',
    timestamp: '2026-03-29T00:00:00.000Z',
    type: 'session_started',
  });
  publisher.publish(turnFinishedEvent);
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

test('HarnessEventPublisher unsubscribes listeners and swallows listener failures', async () => {
  const publisher = new HarnessEventEmitter();
  let callCount = 0;
  const unsubscribe = publisher.subscribe(() => {
    callCount += 1;
  });

  publisher.subscribe(() => {
    throw new Error('listener boom');
  });

  publisher.publish(createEvent());
  unsubscribe();
  publisher.publish(createEvent());

  await Promise.resolve();

  assert.equal(callCount, 1);
});

test('HarnessEventPublisher protects listeners from event mutation by other listeners', () => {
  const publisher = new HarnessEventEmitter();
  let mutationThrew = false;
  let seenTurnId: string | undefined;

  publisher.subscribe((event) => {
    if (event.type === 'session_started') {
      return;
    }

    try {
      event.turnId = 'mutated-turn';
    } catch {
      mutationThrew = true;
    }
  });

  publisher.subscribe((event) => {
    if (event.type !== 'session_started') {
      seenTurnId = event.turnId;
    }
  });

  publisher.publish(createEvent());

  assert.equal(mutationThrew, true);
  assert.equal(seenTurnId, 'turn-1');
});

test('HarnessEventEmitter validates required fields for turn-scoped events', () => {
  const publisher = new HarnessEventEmitter();
  let callCount = 0;

  publisher.subscribe(() => {
    callCount += 1;
  });

  assert.throws(() => {
    publisher.publish({
      durationMs: 3,
      finalAssistantLength: 1,
      sessionId: 'session-1',
      timestamp: '2026-03-29T00:00:00.000Z',
      totalIterations: 1,
      totalToolCalls: 0,
      type: 'turn_finished',
    } as HarnessEvent);
  });

  assert.equal(callCount, 0);
});
