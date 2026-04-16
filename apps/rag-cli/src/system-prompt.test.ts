import assert from 'node:assert/strict';
import test from 'node:test';

import { getRagCliSystemPrompt } from './system-prompt.js';

test('getRagCliSystemPrompt falls back to a generic assistant prompt when retrieval is disabled', () => {
  const prompt = getRagCliSystemPrompt({ retrievalEnabled: false });

  assert.equal(prompt, 'You are a helpful assistant.');
  assert.doesNotMatch(prompt, /retrieved background documents/);
});
