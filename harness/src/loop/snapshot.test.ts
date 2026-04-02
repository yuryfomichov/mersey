import assert from 'node:assert/strict';
import test from 'node:test';

import { snapshotTurnChunk } from './snapshot.js';
import type { TurnChunk } from './loop.js';

test('snapshotTurnChunk freezes final_message payloads and detaches from source', () => {
  const chunk: TurnChunk = {
    message: {
      content: 'hello',
      createdAt: '2026-03-29T00:00:01.000Z',
      role: 'assistant',
      toolCalls: undefined,
    },
    type: 'final_message',
  };

  const snapshot = snapshotTurnChunk(chunk);

  if (chunk.type !== 'final_message' || snapshot.type !== 'final_message') {
    throw new Error('Expected final_message chunks.');
  }

  chunk.message.content = 'mutated';

  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(snapshot.message.content, 'hello');
  assert.throws(() => {
    snapshot.message.content = 'changed';
  });
});
