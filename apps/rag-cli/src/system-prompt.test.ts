import assert from 'node:assert/strict';
import test from 'node:test';

import { getRagCliSystemPrompt } from './system-prompt.js';

test('getRagCliSystemPrompt uses a generic subject description', () => {
  const prompt = getRagCliSystemPrompt();

  assert.match(
    prompt,
    /You are Mersey, answering questions about the person described in the retrieved background documents/,
  );
  assert.match(prompt, /Answer as Mersey, not as the person in the documents/);
  assert.match(
    prompt,
    /Use third person for the person in the documents unless the user explicitly asks for a first-person interview version/,
  );
  assert.doesNotMatch(prompt, /Yury/);
});

test('getRagCliSystemPrompt falls back to a generic assistant prompt when retrieval is disabled', () => {
  const prompt = getRagCliSystemPrompt({ retrievalEnabled: false });

  assert.equal(prompt, 'You are a helpful assistant.');
  assert.doesNotMatch(prompt, /retrieved background documents/);
});
