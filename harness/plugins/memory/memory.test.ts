import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import { createHarness } from '../../index.js';
import { FakeProvider } from '../../providers/fake.js';
import type { PrepareProviderRequestContext } from '../../runtime/plugins/types.js';
import type { Message } from '../../runtime/sessions/types.js';
import { MemorySessionStore, Session } from '../../sessions/index.js';
import { createMemoryPlugin } from './memory.js';

function createPrepareContext(overrides: Partial<PrepareProviderRequestContext> = {}) {
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
    transcript: [userMessage],
    turnId: 'test-turn',
    userMessage,
    ...overrides,
  };
}

function createBaseRequest() {
  return {
    messages: [{ content: 'hello', role: 'user' as const }],
    stream: false,
    systemPrompt: 'Be helpful.',
    tools: [],
  };
}

test('createMemoryPlugin formats recalled memories into a synthetic user message', async () => {
  let recallContext: { providerName: string; sessionId: string; turnId: string } | null = null;
  const plugin = createMemoryPlugin({
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

  const result = await plugin.prepareProviderRequest?.(createBaseRequest(), createPrepareContext());

  assert.ok(result);
  assert.equal(result?.prependMessages?.[0]?.role, 'user');
  assert.match(result?.prependMessages?.[0]?.content ?? '', /Relevant memory for the next answer/);
  assert.match(result?.prependMessages?.[0]?.content ?? '', /prefs/);
  assert.match(result?.prependMessages?.[0]?.content ?? '', /concise answers/);
  assert.deepEqual(recallContext, {
    providerName: 'fake',
    sessionId: 'test-session',
    turnId: 'test-turn',
  });
});

test('createMemoryPlugin skips recall when topK is zero', async () => {
  let recallCalls = 0;
  const plugin = createMemoryPlugin({
    async recall() {
      recallCalls += 1;
      return [];
    },
    async remember() {},
    topK: 0,
  });

  const result = await plugin.prepareProviderRequest?.(createBaseRequest(), createPrepareContext());

  assert.equal(recallCalls, 0);
  assert.deepEqual(result, {});
});

test('createMemoryPlugin skips recall after the first iteration', async () => {
  let recallCalls = 0;
  const plugin = createMemoryPlugin({
    async recall() {
      recallCalls += 1;
      return [
        {
          content: 'Remembered preference.',
          id: 'pref-1',
        },
      ];
    },
    async remember() {},
  });

  const result = await plugin.prepareProviderRequest?.(createBaseRequest(), createPrepareContext({ iteration: 2 }));

  assert.equal(recallCalls, 0);
  assert.deepEqual(result, {});
});

test('createMemoryPlugin stops before recall when the signal is already aborted', async () => {
  let recallCalls = 0;
  const controller = new AbortController();
  controller.abort();
  const plugin = createMemoryPlugin({
    async recall() {
      recallCalls += 1;
      return [];
    },
    async remember() {},
  });

  await assert.rejects(
    async () => {
      await plugin.prepareProviderRequest?.(
        createBaseRequest(),
        createPrepareContext({
          signal: controller.signal,
        }),
      );
    },
    { name: 'AbortError' },
  );

  assert.equal(recallCalls, 0);
});

test('createMemoryPlugin swallows recall errors by default', async () => {
  const plugin = createMemoryPlugin({
    async recall() {
      throw new Error('memory backend unavailable');
    },
    async remember() {},
  });

  const result = await plugin.prepareProviderRequest?.(createBaseRequest(), createPrepareContext());

  assert.deepEqual(result, {});
});

test('createMemoryPlugin rejects invalid maxContextChars', () => {
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

test('createMemoryPlugin does not swallow abort errors when swallowRecallErrors is true', async () => {
  const plugin = createMemoryPlugin({
    async recall(_query, ctx) {
      ctx.signal?.throwIfAborted();
      return [];
    },
    async remember() {},
    swallowRecallErrors: true,
  });
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    async () => {
      await plugin.prepareProviderRequest?.(
        createBaseRequest(),
        createPrepareContext({
          signal: controller.signal,
        }),
      );
    },
    { name: 'AbortError' },
  );
});

test('createMemoryPlugin swallows backend-local AbortError when the turn signal is not aborted', async () => {
  const plugin = createMemoryPlugin({
    async recall() {
      const error = new Error('backend timeout');
      error.name = 'AbortError';
      throw error;
    },
    async remember() {},
    swallowRecallErrors: true,
  });

  const result = await plugin.prepareProviderRequest?.(createBaseRequest(), createPrepareContext());

  assert.deepEqual(result, {});
});

test('createMemoryPlugin lets recall errors fail when swallowing is disabled', async () => {
  const plugin = createMemoryPlugin({
    async recall() {
      throw new Error('memory backend unavailable');
    },
    async remember() {},
    swallowRecallErrors: false,
  });

  await assert.rejects(async () => {
    await plugin.prepareProviderRequest?.(createBaseRequest(), createPrepareContext());
  }, /memory backend unavailable/);
});

test('createMemoryPlugin does not swallow formatter errors when swallowRecallErrors is true', async () => {
  const plugin = createMemoryPlugin({
    formatMemories() {
      throw new Error('formatter failed');
    },
    async recall() {
      return [
        {
          content: 'remembered preference',
          id: 'pref-1',
        },
      ];
    },
    async remember() {},
    swallowRecallErrors: true,
  });

  await assert.rejects(async () => {
    await plugin.prepareProviderRequest?.(createBaseRequest(), createPrepareContext());
  }, /formatter failed/);
});

test('createMemoryPlugin keeps default memory injection within maxContextChars', async () => {
  const plugin = createMemoryPlugin({
    maxContextChars: 260,
    async recall() {
      return [
        {
          content: 'a'.repeat(200),
          id: 'pref-1',
          source: 'prefs',
        },
      ];
    },
    async remember() {},
  });

  const result = await plugin.prepareProviderRequest?.(createBaseRequest(), createPrepareContext());

  assert.ok(result?.prependMessages?.[0]);
  assert.ok((result?.prependMessages?.[0]?.content.length ?? 0) <= 260);
});

test('memory plugin injects recalled memory without persisting it to session history', async () => {
  const provider = new FakeProvider();
  const session = new Session({
    id: 'memory-session',
    store: new MemorySessionStore(),
  });
  const harness = createHarness({
    plugins: [
      createMemoryPlugin({
        async recall() {
          return [
            {
              content: 'The user is evaluating memory plugin APIs.',
              id: 'fact-1',
              source: 'notes.md',
            },
          ];
        },
        async remember() {},
      }),
    ],
    providerInstance: provider,
    session,
  });

  const reply = await harness.sendMessage('hello');

  assert.equal(reply.content, 'reply:hello');
  assert.equal(provider.requests.length, 1);
  assert.equal(provider.requests[0]?.messages.length, 2);
  assert.match(provider.requests[0]?.messages[0]?.content ?? '', /notes\.md/);
  assert.match(provider.requests[0]?.messages[0]?.content ?? '', /memory plugin APIs/);
  assert.deepEqual(
    harness.session.messages.map((message) => ({ content: message.content, role: message.role })),
    [
      { content: 'hello', role: 'user' },
      { content: 'reply:hello', role: 'assistant' },
    ],
  );
});

test('memory plugin remember runs after a successful commit with narrowed turn context', async () => {
  let remembered: {
    historyBeforeTurn: readonly Message[];
    model: string;
    sessionId: string;
    turnId: string;
    turnMessages: readonly Message[];
  } | null = null;
  let markRemembered!: () => void;
  const rememberedSignal = new Promise<void>((resolve) => {
    markRemembered = resolve;
  });
  const provider = new FakeProvider();
  const session = new Session({
    id: 'remember-session',
    store: new MemorySessionStore(),
  });
  const harness = createHarness({
    plugins: [
      createMemoryPlugin({
        async recall() {
          return [];
        },
        async remember(ctx) {
          remembered = ctx;
          markRemembered();
        },
      }),
    ],
    providerInstance: provider,
    session,
  });

  await harness.sendMessage('remember this');
  await rememberedSignal;
  await delay(0);

  assert.ok(remembered);
  assert.equal(remembered?.sessionId, 'remember-session');
  assert.equal(remembered?.model, 'fake-model');
  assert.equal(remembered?.historyBeforeTurn.length, 0);
  assert.deepEqual(
    remembered?.turnMessages.map((message) => ({ content: message.content, role: message.role })),
    [
      { content: 'remember this', role: 'user' },
      { content: 'reply:remember this', role: 'assistant' },
    ],
  );
  assert.equal('provider' in (remembered as Record<string, unknown>), false);
});

test('memory plugin remember does not run when the turn fails before commit', async () => {
  let rememberCalls = 0;
  const provider = {
    model: 'broken-model',
    name: 'broken-provider',
    async *generate() {
      yield* [];
      throw new Error('provider failed');
    },
  };
  const session = new Session({
    id: 'failed-memory-session',
    store: new MemorySessionStore(),
  });
  const harness = createHarness({
    plugins: [
      createMemoryPlugin({
        async recall() {
          return [];
        },
        async remember() {
          rememberCalls += 1;
        },
      }),
    ],
    providerInstance: provider,
    session,
  });

  await assert.rejects(async () => {
    await harness.sendMessage('hello');
  }, /provider failed/);
  await delay(0);

  assert.equal(rememberCalls, 0);
});

test('memory plugin propagates abort through harness sendMessage during in-flight recall', async () => {
  const controller = new AbortController();
  let markAbortListenerReady!: () => void;
  const abortListenerReady = new Promise<void>((resolve) => {
    markAbortListenerReady = resolve;
  });
  const provider = new FakeProvider();
  const session = new Session({
    id: 'abort-memory-session',
    store: new MemorySessionStore(),
  });
  const harness = createHarness({
    plugins: [
      createMemoryPlugin({
        async recall(_query, ctx) {
          await new Promise((_, reject) => {
            ctx.signal?.addEventListener(
              'abort',
              () => {
                reject(ctx.signal?.reason);
              },
              { once: true },
            );
            markAbortListenerReady();
          });

          return [];
        },
        async remember() {},
      }),
    ],
    providerInstance: provider,
    session,
  });

  const pendingReply = harness.sendMessage('hello', { signal: controller.signal });
  await abortListenerReady;
  controller.abort();

  await assert.rejects(
    async () => {
      await pendingReply;
    },
    { name: 'AbortError' },
  );
  assert.deepEqual(harness.session.messages, []);
  assert.equal(provider.requests.length, 0);
});
