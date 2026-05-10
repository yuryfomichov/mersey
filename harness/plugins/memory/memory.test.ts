import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import { createHarnessRuntime } from '../../index.js';
import { FakeProvider } from '../../providers/fake.js';
import type { TurnContextCollectContext } from '../../runtime/plugins/types.js';
import { MemorySessionStore, Session } from '../../sessions/index.js';
import { createMemoryPlugin } from './memory.js';

function createCollectContext(overrides: Partial<TurnContextCollectContext> = {}): TurnContextCollectContext {
  const userMessage = {
    content: 'hello',
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

test('createMemoryPlugin collector formats recalled memories into a synthetic user contribution', async () => {
  let recallContext: { providerName: string; sessionId: string; turnId: string } | null = null;
  const integration = createMemoryPlugin({
    async recall(_query, ctx) {
      recallContext = {
        providerName: ctx.providerName,
        sessionId: ctx.sessionId,
        turnId: ctx.turnId,
      };
      return [
        {
          content: 'The user prefers concise answers with concrete examples.',
          id: 'pref-1',
          source: 'prefs',
        },
      ];
    },
    async remember() {},
  });

  const contributions = await integration.collector.collect(createCollectContext());

  assert.equal(contributions[0]?.kind, 'message');
  assert.match(contributions[0]?.kind === 'message' ? contributions[0].message.content : '', /Relevant memory/);
  assert.match(contributions[0]?.kind === 'message' ? contributions[0].message.content : '', /prefs/);
  assert.deepEqual(recallContext, {
    providerName: 'fake',
    sessionId: 'test-session',
    turnId: 'test-turn',
  });
});

test('createMemoryPlugin collector skips recall when topK is zero or after the first iteration', async () => {
  let recallCalls = 0;
  const integration = createMemoryPlugin({
    async recall() {
      recallCalls += 1;
      return [];
    },
    async remember() {},
    topK: 0,
  });

  assert.deepEqual(await integration.collector.collect(createCollectContext()), []);
  assert.equal(recallCalls, 0);

  const laterIntegration = createMemoryPlugin({
    async recall() {
      recallCalls += 1;
      return [];
    },
    async remember() {},
  });

  assert.deepEqual(await laterIntegration.collector.collect(createCollectContext({ iteration: 2 })), []);
});

test('createMemoryPlugin collector handles aborts and swallowed recall failures correctly', async () => {
  const controller = new AbortController();
  controller.abort();
  const abortingIntegration = createMemoryPlugin({
    async recall() {
      return [];
    },
    async remember() {},
  });

  await assert.rejects(
    async () => {
      await abortingIntegration.collector.collect(createCollectContext({ signal: controller.signal }));
    },
    { name: 'AbortError' },
  );

  const swallowingIntegration = createMemoryPlugin({
    async recall() {
      throw new Error('memory backend unavailable');
    },
    async remember() {},
  });

  assert.deepEqual(await swallowingIntegration.collector.collect(createCollectContext()), []);
  assert.throws(
    () =>
      createMemoryPlugin({
        maxContextChars: 0,
        async recall() {
          return [];
        },
        async remember() {},
      }),
    /maxContextChars must be a positive integer/,
  );
});

test('createMemoryPlugin commit observer runs after a successful committed turn', async () => {
  let rememberedSessionId: string | null = null;
  let markRemembered!: () => void;
  const remembered = new Promise<void>((resolve) => {
    markRemembered = resolve;
  });

  const runtimeResult = await createHarnessRuntime({
    collectors: [
      {
        required: false,
        sourceId: 'memory',
        value: createMemoryPlugin({
          async recall() {
            return [];
          },
          async remember(ctx) {
            rememberedSessionId = ctx.sessionId;
            markRemembered();
          },
        }).collector,
      },
    ],
    commitObservers: [
      {
        required: false,
        sourceId: 'memory',
        value: createMemoryPlugin({
          async recall() {
            return [];
          },
          async remember(ctx) {
            rememberedSessionId = ctx.sessionId;
            markRemembered();
          },
        }).commitObserver,
      },
    ],
    providerInstance: new FakeProvider(),
    session: new Session({
      id: 'remember-session',
      store: new MemorySessionStore(),
    }),
  });
  assert.equal(runtimeResult.ok, true);
  if (!runtimeResult.ok) {
    return;
  }

  await runtimeResult.runtime.harness.sendMessage('remember this');
  await remembered;
  await delay(0);

  assert.equal(rememberedSessionId, 'remember-session');
});

test('createMemoryPlugin commit observer does not run when the turn fails before commit', async () => {
  let rememberCalls = 0;
  const integration = createMemoryPlugin({
    async recall() {
      return [];
    },
    async remember() {
      rememberCalls += 1;
    },
  });

  const runtimeResult = await createHarnessRuntime({
    collectors: [{ required: false, sourceId: 'memory', value: integration.collector }],
    commitObservers: [{ required: false, sourceId: 'memory', value: integration.commitObserver }],
    providerInstance: {
      model: 'broken-model',
      name: 'broken-provider',
      async *generate() {
        yield* [];
        throw new Error('provider failed');
      },
    },
    session: new Session({
      id: 'failed-memory-session',
      store: new MemorySessionStore(),
    }),
  });
  assert.equal(runtimeResult.ok, true);
  if (!runtimeResult.ok) {
    return;
  }

  await assert.rejects(async () => {
    await runtimeResult.runtime.harness.sendMessage('hello');
  }, /provider failed/);
  await delay(0);

  assert.equal(rememberCalls, 0);
});
