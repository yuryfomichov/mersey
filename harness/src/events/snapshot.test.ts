import assert from 'node:assert/strict';
import test from 'node:test';

import { snapshotEvent } from './snapshot.js';
import type { HarnessEvent } from './types.js';

test('snapshotEvent freezes nested event payloads', () => {
  const event: HarnessEvent = {
    debugArgs: { path: 'note.txt' },
    iteration: 1,
    safeArgs: {
      path: {
        basename: 'note.txt',
        digest: 'abc123',
        length: 8,
        looksAbsolute: false,
        present: true,
      },
    },
    sessionId: 'session-1',
    timestamp: '2026-03-29T00:00:00.000Z',
    toolCallId: 'call-1',
    toolName: 'read_file',
    turnId: 'turn-1',
    type: 'tool_requested',
  };

  const snapshot = snapshotEvent(event);

  assert.equal(Object.isFrozen(snapshot), true);
  assert.throws(() => {
    if (snapshot.type === 'tool_requested' && snapshot.safeArgs.path) {
      snapshot.safeArgs.path.basename = 'changed.txt';
    }
  });
});
