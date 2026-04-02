import assert from 'node:assert/strict';
import test from 'node:test';

import { limitText } from './output.js';

test('limitText handles zero-byte limits without hanging', () => {
  assert.deepEqual(limitText('hello', 0), {
    originalBytes: 5,
    text: '',
    truncated: true,
  });
});

test('limitText does not leave a dangling surrogate at the truncation boundary', () => {
  const result = limitText('ok 😀', 5);

  assert.deepEqual(result, {
    originalBytes: 7,
    text: 'ok ',
    truncated: true,
  });
});
