import type { ModelStreamEvent } from '../../src/models/types.js';

export async function collectEvents(iterable: AsyncIterable<ModelStreamEvent>): Promise<ModelStreamEvent[]> {
  const events: ModelStreamEvent[] = [];

  for await (const event of iterable) {
    events.push(event);
  }

  return events;
}

export async function collectResponse(
  iterable: AsyncIterable<ModelStreamEvent>,
): Promise<Extract<ModelStreamEvent, { type: 'response_completed' }>['response']> {
  const events = await collectEvents(iterable);
  const responseEvents = events.filter(
    (event): event is Extract<ModelStreamEvent, { type: 'response_completed' }> => event.type === 'response_completed',
  );

  if (responseEvents.length !== 1) {
    throw new Error(`Expected exactly one response_completed event, got ${responseEvents.length}.`);
  }

  const responseEvent = responseEvents[0];
  const lastEvent = events[events.length - 1];

  if (lastEvent !== responseEvent) {
    throw new Error('Expected response_completed to be the last event.');
  }

  return responseEvent.response;
}
