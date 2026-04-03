import type { ModelStreamEvent } from '../src/models/types.js';

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
  const responseEvent = events.find((event) => event.type === 'response_completed');

  if (!responseEvent || responseEvent.type !== 'response_completed') {
    throw new Error('Expected a response_completed event.');
  }

  return responseEvent.response;
}
