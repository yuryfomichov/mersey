import assert from 'node:assert/strict';
import test from 'node:test';

import { freezeDeep } from './object.js';

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
