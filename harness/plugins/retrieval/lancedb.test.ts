import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';

import { createHarness } from '../../index.js';
import { FakeProvider } from '../../providers/fake.js';
import { withTempDir } from '../../runtime/test/test-helpers.js';
import { MemorySessionStore, Session } from '../../sessions/index.js';
import { buildLanceDbIndex, createLanceDbRetrievalPlugin } from './lancedb/index.js';
import { createRetrievalPlugin } from './retrieval.js';

function createPrepareContext() {
  const userMessage = {
    content: 'payments',
    createdAt: new Date().toISOString(),
    role: 'user' as const,
  };

  return {
    iteration: 1,
    model: 'fake-model',
    providerName: 'fake',
    sessionId: 'test-session',
    signal: undefined,
    transcript: [userMessage],
    turnId: 'test-turn',
    userMessage,
  };
}

function embedText(text: string): number[] {
  const normalized = text.toLowerCase();
  const count = (term: string): number => normalized.split(term).length - 1;

  return [count('payments'), count('frontend'), count('search')];
}

test('createRetrievalPlugin formats retrieved chunks into a synthetic user message', async () => {
  const plugin = createRetrievalPlugin({
    maxContextChars: 220,
    async retrieve() {
      return [
        {
          content: 'Built a payments platform for global merchants.',
          id: 'doc-1',
          source: 'resume.md',
        },
      ];
    },
  });

  const result = await plugin.prepareProviderRequest?.(
    {
      messages: [{ content: 'payments', role: 'user' }],
      stream: false,
      systemPrompt: 'Be helpful.',
      tools: [],
    },
    createPrepareContext(),
  );

  assert.ok(result);
  assert.equal(result?.prependMessages?.[0]?.role, 'user');
  assert.match(result?.prependMessages?.[0]?.content ?? '', /Retrieved context for the next answer/);
  assert.match(result?.prependMessages?.[0]?.content ?? '', /resume\.md/);
  assert.match(result?.prependMessages?.[0]?.content ?? '', /payments platform/);
});

test('createRetrievalPlugin rejects invalid maxContextChars', () => {
  assert.throws(
    () =>
      createRetrievalPlugin({
        maxContextChars: 0,
        async retrieve() {
          return [];
        },
      }),
    /maxContextChars must be a positive integer/,
  );
});

test('createRetrievalPlugin skips backend retrieval when topK is zero', async () => {
  let retrieveCalls = 0;
  const plugin = createRetrievalPlugin({
    topK: 0,
    async retrieve() {
      retrieveCalls += 1;
      return [
        {
          content: 'Built a payments platform for global merchants.',
          id: 'doc-1',
        },
      ];
    },
  });

  const result = await plugin.prepareProviderRequest?.(
    {
      messages: [{ content: 'payments', role: 'user' }],
      stream: false,
      systemPrompt: 'Be helpful.',
      tools: [],
    },
    createPrepareContext(),
  );

  assert.equal(retrieveCalls, 0);
  assert.deepEqual(result, {});
});

test('createRetrievalPlugin stops before backend retrieval when the signal is already aborted', async () => {
  let retrieveCalls = 0;
  const controller = new AbortController();
  controller.abort();
  const plugin = createRetrievalPlugin({
    async retrieve() {
      retrieveCalls += 1;
      return [];
    },
  });

  await assert.rejects(
    async () => {
      await plugin.prepareProviderRequest?.(
        {
          messages: [{ content: 'payments', role: 'user' }],
          stream: false,
          systemPrompt: 'Be helpful.',
          tools: [],
        },
        {
          ...createPrepareContext(),
          signal: controller.signal,
        },
      );
    },
    { name: 'AbortError' },
  );

  assert.equal(retrieveCalls, 0);
});

test('LanceDB retrieval plugin skips search when the query embedding is all zeros', async () => {
  const plugin = createLanceDbRetrievalPlugin({
    dbPath: '/path/that/should/not/be/opened',
    embedQuery: async () => [0, 0, 0],
    topK: 1,
  });

  const result = await plugin.prepareProviderRequest?.(
    {
      messages: [{ content: 'R', role: 'user' }],
      stream: false,
      systemPrompt: 'Be helpful.',
      tools: [],
    },
    {
      ...createPrepareContext(),
      userMessage: { content: 'R', role: 'user' },
    },
  );

  assert.deepEqual(result, {});
});

test('LanceDB retrieval plugin stops before opening the table when embedding aborts the request', async () => {
  const controller = new AbortController();
  const plugin = createLanceDbRetrievalPlugin({
    dbPath: '/path/that/should/not/be/opened',
    embedQuery: async () => {
      controller.abort();
      return [1, 0, 0];
    },
    topK: 1,
  });

  await assert.rejects(
    async () => {
      await plugin.prepareProviderRequest?.(
        {
          messages: [{ content: 'payments', role: 'user' }],
          stream: false,
          systemPrompt: 'Be helpful.',
          tools: [],
        },
        {
          ...createPrepareContext(),
          signal: controller.signal,
        },
      );
    },
    { name: 'AbortError' },
  );
});

test('LanceDB retrieval plugin injects indexed context without persisting it to session history', async () => {
  await withTempDir(async (rootDir) => {
    const dbPath = join(rootDir, 'rag-db');

    await buildLanceDbIndex({
      dbPath,
      documents: [
        {
          content: 'Built a payments platform for global merchants.',
          id: 'resume-1',
          source: 'resume.md',
          title: 'Payments Work',
        },
        {
          content: 'Led frontend redesign for an analytics dashboard.',
          id: 'resume-2',
          source: 'frontend.md',
          title: 'Frontend Work',
        },
      ],
      embedDocuments: async (texts) => texts.map(embedText),
      replace: true,
    });

    const provider = new FakeProvider();
    const session = new Session({
      id: 'rag-session',
      store: new MemorySessionStore(),
    });
    const harness = createHarness({
      plugins: [
        createLanceDbRetrievalPlugin({
          dbPath,
          embedQuery: async (text) => embedText(text),
          topK: 1,
        }),
      ],
      providerInstance: provider,
      session,
    });

    const reply = await harness.sendMessage('payments');

    assert.equal(reply.content, 'reply:payments');
    assert.equal(provider.requests.length, 1);
    assert.equal(provider.requests[0]?.messages.length, 2);
    assert.match(provider.requests[0]?.messages[0]?.content ?? '', /resume\.md/);
    assert.match(provider.requests[0]?.messages[0]?.content ?? '', /payments platform/);
    assert.deepEqual(
      harness.session.messages.map((message) => ({ content: message.content, role: message.role })),
      [
        { content: 'payments', role: 'user' },
        { content: 'reply:payments', role: 'assistant' },
      ],
    );
  });
});
