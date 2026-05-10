import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';

import { createHarnessRuntime } from '../../index.js';
import { FakeProvider } from '../../providers/fake.js';
import type { TurnContextCollectContext } from '../../runtime/plugins/types.js';
import { withTempDir } from '../../runtime/test/test-helpers.js';
import { MemorySessionStore, Session } from '../../sessions/index.js';
import { buildLanceDbIndex, createLanceDbRetrievalPlugin } from './lancedb/index.js';
import { createRetrievalPlugin } from './retrieval.js';

function createCollectContext(overrides: Partial<TurnContextCollectContext> = {}): TurnContextCollectContext {
  const userMessage = {
    content: 'payments',
    role: 'user' as const,
  };

  return {
    iteration: 1,
    model: 'fake-model',
    providerName: 'fake',
    sessionId: 'test-session',
    signal: undefined,
    transcript: [],
    turnId: 'test-turn',
    userMessage,
    ...overrides,
  };
}

function embedText(text: string): number[] {
  const normalized = text.toLowerCase();
  const count = (term: string): number => normalized.split(term).length - 1;

  return [count('payments'), count('frontend'), count('search')];
}

test('createRetrievalPlugin collector formats retrieved chunks into a synthetic user contribution', async () => {
  const collector = createRetrievalPlugin({
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

  const contributions = await collector.collect(createCollectContext());

  assert.equal(contributions[0]?.kind, 'message');
  assert.match(contributions[0]?.kind === 'message' ? contributions[0].message.content : '', /Retrieved context/);
  assert.match(contributions[0]?.kind === 'message' ? contributions[0].message.content : '', /resume\.md/);
});

test('createRetrievalPlugin validates limits and propagates abort before retrieval', async () => {
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

  let retrieveCalls = 0;
  const collector = createRetrievalPlugin({
    topK: 0,
    async retrieve() {
      retrieveCalls += 1;
      return [];
    },
  });
  assert.deepEqual(await collector.collect(createCollectContext()), []);
  assert.equal(retrieveCalls, 0);

  const controller = new AbortController();
  controller.abort();
  const abortingCollector = createRetrievalPlugin({
    async retrieve() {
      retrieveCalls += 1;
      return [];
    },
  });

  await assert.rejects(
    async () => {
      await abortingCollector.collect(createCollectContext({ signal: controller.signal }));
    },
    { name: 'AbortError' },
  );
});

test('LanceDB retrieval plugin skips search for zero vectors and rejects invalid embeddings', async () => {
  const zeroCollector = createLanceDbRetrievalPlugin({
    dbPath: '/path/that/should/not/be/opened',
    embedQuery: async () => [0, 0, 0],
    topK: 1,
  });

  assert.deepEqual(await zeroCollector.collect(createCollectContext()), []);

  const invalidCollector = createLanceDbRetrievalPlugin({
    dbPath: '/path/that/should/not/be/opened',
    embedQuery: async () => [Number.NaN, 0, 1],
    topK: 1,
  });

  await assert.rejects(async () => {
    await invalidCollector.collect(createCollectContext());
  }, /query embedding must be a non-empty numeric vector/);
});

test('buildLanceDbIndex rejects non-finite document embeddings', async () => {
  await withTempDir(async (rootDir) => {
    await assert.rejects(
      () =>
        buildLanceDbIndex({
          dbPath: join(rootDir, 'rag-db'),
          documents: [
            {
              content: 'Built a payments platform for global merchants.',
              id: 'resume-1',
              source: 'resume.md',
            },
          ],
          embedDocuments: async () => [[Infinity, 0, 1]],
          replace: true,
        }),
      /embedding 1 must be a non-empty numeric vector/,
    );
  });
});

test('LanceDB retrieval collector injects indexed context without persisting it to session history', async () => {
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
    const runtimeResult = await createHarnessRuntime({
      collectors: [
        {
          required: false,
          sourceId: 'rag',
          value: createLanceDbRetrievalPlugin({
            dbPath,
            embedQuery: async (text) => embedText(text),
            topK: 1,
          }),
        },
      ],
      providerInstance: provider,
      session: new Session({
        id: 'rag-session',
        store: new MemorySessionStore(),
      }),
    });
    assert.equal(runtimeResult.ok, true);
    if (!runtimeResult.ok) {
      return;
    }

    const harness = runtimeResult.runtime.harness;

    const reply = await harness.sendMessage('payments');

    assert.equal(reply.content, 'reply:payments');
    assert.equal(provider.requests.length, 1);
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
