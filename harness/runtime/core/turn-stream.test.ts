import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import { FakeProvider } from '../../providers/fake.js';
import { MemorySessionStore, Session } from '../../sessions/index.js';
import { TurnCommitObserverRunner } from '../commit/runner.js';
import { TurnContextCollectorRunner } from '../context/runner.js';
import { HarnessEventReporter } from '../events/reporter.js';
import { RuntimeWorkTracker } from '../lifecycle.js';
import { createPluginRunner } from '../plugins/runner.js';
import { ComposedToolCatalog } from '../tools/composed-catalog.js';
import { asFinalMessage, createTurnStreamFactory } from './turn-stream.js';

function createFactory(
  options: {
    provider?: FakeProvider;
    remember?(turnId: string): Promise<void> | void;
    store?: MemorySessionStore;
  } = {},
) {
  const reporter = new HarnessEventReporter({
    getSessionId: () => 'session-1',
    providerName: 'fake',
  });
  const workTracker = new RuntimeWorkTracker();
  const provider = options.provider ?? new FakeProvider();
  const pluginRunner = createPluginRunner({ plugins: [], reporter, runId: 'run-1', workTracker });
  const commitObservers = new TurnCommitObserverRunner({
    registrations: options.remember
      ? [
          {
            sourceId: 'observer',
            value: {
              async afterTurnCommitted(ctx) {
                await options.remember?.(ctx.turnId);
              },
            },
          },
        ]
      : [],
    reporter,
    workTracker,
  });

  return {
    factory: createTurnStreamFactory({
      commitObservers,
      contextCollectors: new TurnContextCollectorRunner([]),
      pluginRunner,
      provider,
      reporter,
      session: new Session({ id: 'session-1', store: options.store ?? new MemorySessionStore() }),
      toolCatalog: new ComposedToolCatalog([]),
      workTracker,
    }),
    workTracker,
  };
}

test('asFinalMessage returns the committed assistant message', async () => {
  const { factory } = createFactory();

  const message = await asFinalMessage(factory)('hello');

  assert.equal(message.role, 'assistant');
  assert.equal(message.content, 'reply:hello');
});

test('createTurnStreamFactory runs commit observers after a successful commit', async () => {
  let rememberedTurnId: string | null = null;
  let resolveRemembered!: () => void;
  const remembered = new Promise<void>((resolve) => {
    resolveRemembered = resolve;
  });
  const { factory, workTracker } = createFactory({
    async remember(turnId) {
      rememberedTurnId = turnId;
      resolveRemembered();
    },
  });

  const message = await asFinalMessage(factory)('hello');
  await remembered;
  await workTracker.dispose();

  assert.equal(message.content, 'reply:hello');
  assert.ok(rememberedTurnId);
});

test('createTurnStreamFactory does not yield final_message before commit succeeds', async () => {
  let releaseCommit!: () => void;
  let commitStarted!: () => void;
  const commitStartedPromise = new Promise<void>((resolve) => {
    commitStarted = resolve;
  });
  const releaseCommitPromise = new Promise<void>((resolve) => {
    releaseCommit = resolve;
  });

  class BlockingCommitStore extends MemorySessionStore {
    override async commitTurnExclusive(...args: Parameters<MemorySessionStore['commitTurnExclusive']>) {
      commitStarted();
      await releaseCommitPromise;
      return super.commitTurnExclusive(...args);
    }
  }

  const { factory } = createFactory({ store: new BlockingCommitStore() });
  const iterator = factory('hello', false)[Symbol.asyncIterator]();
  const nextResult = iterator.next();

  await commitStartedPromise;
  assert.equal(await Promise.race([nextResult.then(() => 'yielded'), delay(20).then(() => 'waiting')]), 'waiting');

  releaseCommit();
  const result = await nextResult;

  assert.equal(result.done, false);
  assert.equal(result.value?.type, 'final_message');
});

test('turn stream return aborts an in-flight provider request', async () => {
  const provider = new FakeProvider({
    streamReply: (input) => ({
      async *[Symbol.asyncIterator]() {
        yield { delta: 'partial', type: 'text_delta' as const };
        await new Promise((_, reject) => {
          input.signal?.addEventListener(
            'abort',
            () => {
              reject(input.signal?.reason);
            },
            { once: true },
          );
        });
      },
    }),
  });
  const { factory } = createFactory({ provider });
  const stream = factory('hello');
  const iterator = stream[Symbol.asyncIterator]();

  const firstChunk = await iterator.next();
  assert.equal(firstChunk.value?.type, 'assistant_delta');

  await iterator.return?.();
});
