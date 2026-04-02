import assert from 'node:assert/strict';
import test from 'node:test';

import { snapshotMessages, snapshotSessionState } from './snapshot.js';
import type { Message, SessionState } from './types.js';

test('snapshotMessages freezes both the array and nested message objects', () => {
  const messages: Message[] = [
    {
      content: 'hello',
      createdAt: '2026-03-29T00:00:01.000Z',
      role: 'assistant',
      toolCalls: [
        {
          id: 'call-1',
          input: { path: 'note.txt' },
          name: 'read_file',
        },
      ],
    },
  ];

  const snapshot = snapshotMessages(messages);

  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot[0] ?? null), true);
  assert.throws(() => {
    (snapshot as Message[]).push({
      content: 'later',
      createdAt: '2026-03-29T00:00:02.000Z',
      role: 'assistant',
      toolCalls: undefined,
    });
  });
  assert.throws(() => {
    if (snapshot[0] && 'toolCalls' in snapshot[0] && snapshot[0].toolCalls?.[0]) {
      snapshot[0].toolCalls[0].input = { path: 'changed.txt' };
    }
  });
});

test('snapshotSessionState disconnects from later caller mutation', () => {
  const state: SessionState = {
    createdAt: '2026-03-29T00:00:00.000Z',
    id: 'session-1',
    messages: [
      {
        content: 'hello',
        createdAt: '2026-03-29T00:00:01.000Z',
        role: 'assistant',
        toolCalls: undefined,
      },
    ],
  };

  const snapshot = snapshotSessionState(state);

  state.messages[0]!.content = 'mutated';

  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.messages), true);
  assert.equal(snapshot.messages[0]?.content, 'hello');
});
