import assert from 'node:assert/strict';
import test from 'node:test';

import { FakeProvider } from '../../providers/fake.js';
import { TurnContextCollectorRunner } from '../context/runner.js';
import { HarnessEventReporter } from '../events/reporter.js';
import { RuntimeWorkTracker } from '../lifecycle.js';
import { createPluginRunner } from '../plugins/runner.js';
import { ComposedToolCatalog } from '../tools/composed-catalog.js';
import { createStaticToolCatalog } from '../tools/runtime/index.js';
import { createTextToolResult, type Tool } from '../tools/types.js';
import { streamLoop } from './loop.js';

function createReporter() {
  return new HarnessEventReporter({
    getSessionId: () => 'session-1',
    providerName: 'fake',
  });
}

test('streamLoop injects collected context without persisting it to turn messages', async () => {
  const provider = new FakeProvider();
  const reporter = createReporter();
  const pluginRunner = createPluginRunner({
    plugins: [],
    reporter,
    runId: 'run-1',
    workTracker: new RuntimeWorkTracker(),
  });
  const collectorRunner = new TurnContextCollectorRunner([
    {
      sourceId: 'retrieval',
      value: {
        async collect() {
          return [
            {
              kind: 'message',
              message: {
                content: 'Retrieved context about payments.',
                role: 'user',
              },
              sourceId: 'retrieval',
            },
          ];
        },
      },
    },
  ]);
  const toolCatalog = new ComposedToolCatalog([]);

  const iterator = streamLoop({
    content: 'payments',
    contextCollectors: collectorRunner,
    history: [],
    pluginRunner,
    provider,
    reporter,
    stream: false,
    toolCatalog,
  });

  let result = await iterator.next();
  while (!result.done) {
    result = await iterator.next();
  }

  assert.equal(provider.requests.length, 1);
  assert.equal(provider.requests[0]?.messages.length, 2);
  assert.match(provider.requests[0]?.messages[0]?.content ?? '', /Retrieved context about payments/);
  assert.deepEqual(
    result.value.map((message) => ({ content: message.content, role: message.role })),
    [
      { content: 'payments', role: 'user' },
      { content: 'reply:payments', role: 'assistant' },
    ],
  );
});

test('streamLoop gives collectors transcript snapshots instead of live turn messages', async () => {
  const provider = new FakeProvider();
  const reporter = createReporter();
  const pluginRunner = createPluginRunner({
    plugins: [],
    reporter,
    runId: 'run-1',
    workTracker: new RuntimeWorkTracker(),
  });
  const collectorRunner = new TurnContextCollectorRunner([
    {
      sourceId: 'mutating-collector',
      value: {
        async collect(ctx) {
          const firstMessage = ctx.transcript[0];

          if (firstMessage) {
            (firstMessage as { content: string }).content = 'mutated by collector';
          }

          return [];
        },
      },
    },
  ]);

  const iterator = streamLoop({
    content: 'original user input',
    contextCollectors: collectorRunner,
    history: [],
    pluginRunner,
    provider,
    reporter,
    stream: false,
    toolCatalog: new ComposedToolCatalog([]),
  });

  let result = await iterator.next();
  while (!result.done) {
    result = await iterator.next();
  }

  assert.equal(provider.requests[0]?.messages.at(-1)?.content, 'original user input');
  assert.equal(result.value[0]?.content, 'original user input');
});

test('streamLoop resolves tools and appends structured tool result messages', async () => {
  const tool: Tool = {
    description: 'Return hello',
    async execute() {
      return createTextToolResult('tool-output');
    },
    inputSchema: { type: 'object' },
    name: 'workspace.hello',
  };
  let providerCalls = 0;
  const provider = new FakeProvider({
    reply: (input) => {
      providerCalls += 1;
      if (providerCalls === 1) {
        return {
          text: '',
          toolCalls: [{ id: 'call-1', input: {}, name: 'workspace_hello' }],
          usage: { cacheWriteInputTokens: 0, cachedInputTokens: 0, outputTokens: 0, uncachedInputTokens: 0 },
        };
      }

      return `reply:${input.messages.at(-1)?.content ?? ''}`;
    },
  });

  const reporter = createReporter();
  const pluginRunner = createPluginRunner({
    plugins: [],
    reporter,
    runId: 'run-1',
    workTracker: new RuntimeWorkTracker(),
  });
  const collectorRunner = new TurnContextCollectorRunner([]);
  const toolCatalog = new ComposedToolCatalog([
    {
      sourceId: 'local-tools',
      value: createStaticToolCatalog({ sourceId: 'local-tools', tools: [tool] }),
    },
  ]);

  const iterator = streamLoop({
    content: 'hello',
    contextCollectors: collectorRunner,
    history: [],
    pluginRunner,
    provider,
    reporter,
    stream: false,
    systemPrompt: 'Use tools carefully.',
    toolCatalog,
  });

  let result = await iterator.next();
  while (!result.done) {
    result = await iterator.next();
  }

  const toolMessage = result.value.find((message) => message.role === 'tool');
  assert.ok(toolMessage);
  if (!toolMessage || toolMessage.role !== 'tool') {
    return;
  }

  assert.equal(toolMessage.publicName, 'workspace_hello');
  assert.equal(toolMessage.toolId, 'local-tools:workspace.hello');
  assert.equal(toolMessage.parts[0]?.type, 'text');
  assert.equal(toolMessage.parts[0]?.type === 'text' ? toolMessage.parts[0].text : '', 'tool-output');
  assert.deepEqual(
    provider.requests.map((request) => request.systemPrompt),
    ['Use tools carefully.', 'Use tools carefully.'],
  );
});

test('streamLoop returns unknown-tool error results when resolution fails', async () => {
  let providerCalls = 0;
  const provider = new FakeProvider({
    reply: () => {
      providerCalls += 1;
      if (providerCalls === 1) {
        return {
          text: '',
          toolCalls: [{ id: 'call-1', input: {}, name: 'missing.tool' }],
          usage: { cacheWriteInputTokens: 0, cachedInputTokens: 0, outputTokens: 0, uncachedInputTokens: 0 },
        };
      }

      return 'final';
    },
  });

  const reporter = createReporter();
  const pluginRunner = createPluginRunner({
    plugins: [],
    reporter,
    runId: 'run-1',
    workTracker: new RuntimeWorkTracker(),
  });
  const collectorRunner = new TurnContextCollectorRunner([]);
  const toolCatalog = new ComposedToolCatalog([]);

  const iterator = streamLoop({
    content: 'hello',
    contextCollectors: collectorRunner,
    history: [],
    pluginRunner,
    provider,
    reporter,
    stream: false,
    toolCatalog,
  });

  let result = await iterator.next();
  while (!result.done) {
    result = await iterator.next();
  }

  const toolMessage = result.value.find((message) => message.role === 'tool');
  assert.ok(toolMessage);
  assert.match(toolMessage?.content ?? '', /Unknown tool: missing.tool/);
});

test('streamLoop emits turn_snapshot_failed when a required collector fails before provider execution', async () => {
  const provider = new FakeProvider();
  const reporter = createReporter();
  const events: string[] = [];
  const affectedSourceIds: string[][] = [];

  reporter.subscribe((event) => {
    events.push(event.type);

    if (event.type === 'turn_snapshot_failed') {
      affectedSourceIds.push(event.affectedSourceIds);
    }
  });

  const pluginRunner = createPluginRunner({
    plugins: [],
    reporter,
    runId: 'run-1',
    workTracker: new RuntimeWorkTracker(),
  });
  const collectorRunner = new TurnContextCollectorRunner([
    {
      required: true,
      sourceId: 'retrieval',
      value: {
        async collect() {
          throw new Error('retrieval unavailable');
        },
      },
    },
  ]);

  await assert.rejects(async () => {
    for await (const _chunk of streamLoop({
      content: 'payments',
      contextCollectors: collectorRunner,
      history: [],
      pluginRunner,
      provider,
      reporter,
      stream: false,
      toolCatalog: new ComposedToolCatalog([]),
    })) {
      // no-op
    }
  }, /retrieval unavailable/);

  assert.deepEqual(events, ['turn_started', 'turn_snapshot_started', 'turn_snapshot_failed', 'turn_failed']);
  assert.deepEqual(affectedSourceIds, [['retrieval']]);
  assert.equal(provider.requests.length, 0);
});
