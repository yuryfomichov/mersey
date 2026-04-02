import assert from 'node:assert/strict';
import test from 'node:test';

import { freezeDeep, snapshot } from './object.js';

test('freezeDeep recursively freezes nested objects', () => {
  const value = {
    nested: {
      answer: 42,
    },
  };

  const frozen = freezeDeep(value);

  assert.equal(Object.isFrozen(frozen), true);
  assert.equal(Object.isFrozen(frozen.nested), true);
  assert.throws(() => {
    (frozen.nested as { answer: number }).answer = 7;
  });
});

test('freezeDeep handles cyclic objects', () => {
  const value: { self?: unknown } = {};

  value.self = value;

  const frozen = freezeDeep(value);

  assert.equal(Object.isFrozen(frozen), true);
  assert.equal(frozen.self, frozen);
});

test('snapshot clones and freezes nested data', () => {
  const value = {
    items: [{ content: 'hello' }],
  };

  const frozenSnapshot = snapshot(value);

  value.items[0]!.content = 'changed';

  assert.equal(Object.isFrozen(frozenSnapshot), true);
  assert.equal(Object.isFrozen(frozenSnapshot.items), true);
  assert.equal(Object.isFrozen(frozenSnapshot.items[0] ?? null), true);
  assert.equal(frozenSnapshot.items[0]?.content, 'hello');
  assert.throws(() => {
    frozenSnapshot.items[0]!.content = 'mutated';
  });
});
