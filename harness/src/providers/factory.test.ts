import assert from 'node:assert/strict';
import test from 'node:test';

import { parseProviderName, createProvider } from './factory.js';
import { FakeProvider } from './fake.js';
import { MinimaxProvider } from './minimax.js';
import { OpenAIProvider } from './openai.js';

test('parseProviderName supports known providers and rejects unknown ones', () => {
  assert.equal(parseProviderName('fake'), 'fake');
  assert.equal(parseProviderName('minimax'), 'minimax');
  assert.equal(parseProviderName('openai'), 'openai');
  assert.throws(() => parseProviderName('openrouter'), /Unsupported provider/);
});

test('createProvider instantiates the requested provider implementation', () => {
  assert.ok(createProvider({ name: 'fake' }) instanceof FakeProvider);
  assert.ok(
    createProvider({
      config: {
        apiKey: 'test-key',
        baseUrl: 'https://example.com',
        maxTokens: 256,
        model: 'claude-test-model',
      },
      name: 'minimax',
    }) instanceof MinimaxProvider,
  );
  assert.ok(
    createProvider({
      config: {
        apiKey: 'test-key',
        baseUrl: 'https://example.com',
        maxTokens: 256,
        model: 'gpt-test-model',
      },
      name: 'openai',
    }) instanceof OpenAIProvider,
  );
});

test('createProvider rejects unsupported provider definitions', () => {
  assert.throws(
    () =>
      createProvider({
        config: undefined,
        name: 'broken',
      } as unknown as Parameters<typeof createProvider>[0]),
    /Unsupported provider definition: broken/,
  );
});
