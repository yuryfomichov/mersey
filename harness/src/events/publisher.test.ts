import assert from 'node:assert/strict';
import test from 'node:test';

import { HarnessEventPublisher } from './publisher.js';
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
  const publisher = new HarnessEventPublisher();
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

test('HarnessEventPublisher unsubscribes listeners and swallows listener failures', async () => {
  const publisher = new HarnessEventPublisher();
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
