import assert from 'node:assert/strict';
import test from 'node:test';

import { createHarness } from './index.js';
import { parseProviderName } from './providers/factory.js';
import { FakeProvider } from './providers/fake.js';

test('createHarness uses the injected provider and appends session history', async () => {
  const provider = new FakeProvider();

  const harness = createHarness({ providerInstance: provider, sessionId: 'test-session' });
  const reply = await harness.sendUserMessage('hello');

  assert.equal(reply.role, 'assistant');
  assert.equal(reply.content, 'reply:hello');
  assert.equal(harness.session.id, 'test-session');
  assert.equal(provider.requests.length, 1);
  assert.deepEqual(provider.requests[0]?.messages, [{ role: 'user', content: 'hello' }]);
  assert.deepEqual(
    harness.session.messages.map((message) => ({ role: message.role, content: message.content })),
    [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'reply:hello' },
    ],
  );
});

test('parseProviderName supports minimax and rejects unknown providers', () => {
  assert.equal(parseProviderName('fake'), 'fake');
  assert.equal(parseProviderName('minimax'), 'minimax');
  assert.throws(() => parseProviderName('openai'), /Unsupported provider/);
});
