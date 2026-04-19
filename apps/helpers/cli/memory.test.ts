import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import { createHarness } from '../../../harness/index.js';
import { FakeProvider } from '../../../harness/providers/index.js';
import { withTempDir } from '../../../harness/runtime/test/test-helpers.js';
import { MemorySessionStore, Session } from '../../../harness/sessions/index.js';
import { createLocalMemoryPlugin, getDefaultLocalMemoryFilePath, getLocalMemoryDefinition } from './memory.js';

test('getLocalMemoryDefinition parses memory flags for rag-cli testing', () => {
  const definition = getLocalMemoryDefinition(['--memory', '--memory-top-k=2'], {
    cwd: '/workspace/mersey',
  });

  assert.deepEqual(definition, {
    enabled: true,
    filePath: '/workspace/mersey/tmp/memory/rag-cli.jsonl',
    maxContextChars: 2000,
    topK: 2,
  });
  assert.equal(getDefaultLocalMemoryFilePath('/workspace/mersey'), '/workspace/mersey/tmp/memory/rag-cli.jsonl');
});

test('getLocalMemoryDefinition validates memory numeric flags', () => {
  assert.throws(
    () => getLocalMemoryDefinition(['--memory', '--memory-top-k=0']),
    /--memory-top-k must be a positive integer/,
  );
  assert.throws(
    () => getLocalMemoryDefinition(['--memory', '--memory-top-k=']),
    /Invalid value for --memory-top-k: value is required/,
  );
  assert.throws(
    () => getLocalMemoryDefinition(['--memory', '--memory-max-context-chars=0']),
    /--memory-max-context-chars must be a positive integer/,
  );
  assert.throws(
    () => getLocalMemoryDefinition(['--memory', '--memory-file=']),
    /Invalid value for --memory-file: value is required/,
  );
});

test('createLocalMemoryPlugin disables memory cleanly when the flag is off', async () => {
  const result = await createLocalMemoryPlugin({
    enabled: false,
    filePath: '/workspace/mersey/tmp/memory/rag-cli.jsonl',
    maxContextChars: 2000,
    topK: 3,
  });

  assert.equal(result.plugin, null);
  assert.deepEqual(result.summaryLines, ['memory: disabled']);
});

test('createLocalMemoryPlugin remembers turns and recalls them across sessions', async () => {
  await withTempDir(async (rootDir) => {
    const filePath = join(rootDir, 'memory', 'rag-cli.jsonl');
    const memoryResult = await createLocalMemoryPlugin({
      enabled: true,
      filePath,
      maxContextChars: 2000,
      topK: 2,
    });

    assert.ok(memoryResult.plugin);
    assert.deepEqual(memoryResult.summaryLines, [`memory: enabled (topK=2)`, `memory file: ${filePath}`]);

    const writerHarness = createHarness({
      plugins: [memoryResult.plugin!],
      providerInstance: new FakeProvider(),
      session: new Session({
        id: 'memory-writer-session',
        store: new MemorySessionStore(),
      }),
      systemPrompt: 'You are a helpful assistant.',
      tools: [],
    });

    await writerHarness.sendMessage('I prefer concise answers about payments.');
    await waitForMemoryWrite(filePath, /concise answers about payments/);

    const readerProvider = new FakeProvider();
    const readerHarness = createHarness({
      plugins: [memoryResult.plugin!],
      providerInstance: readerProvider,
      session: new Session({
        id: 'memory-reader-session',
        store: new MemorySessionStore(),
      }),
      systemPrompt: 'You are a helpful assistant.',
      tools: [],
    });

    const reply = await readerHarness.sendMessage('What do I prefer about payments?');

    assert.equal(reply.content, 'reply:What do I prefer about payments?');
    assert.equal(readerProvider.requests.length, 1);
    assert.match(readerProvider.requests[0]?.messages[0]?.content ?? '', /local-memory:memory-writer-session/);
    assert.match(readerProvider.requests[0]?.messages[0]?.content ?? '', /concise answers about payments/);
    assert.deepEqual(
      readerHarness.session.messages.map((message) => ({ content: message.content, role: message.role })),
      [
        { content: 'What do I prefer about payments?', role: 'user' },
        { content: 'reply:What do I prefer about payments?', role: 'assistant' },
      ],
    );
  });
});

test('createLocalMemoryPlugin skips malformed JSONL rows and still recalls valid memories', async () => {
  await withTempDir(async (rootDir) => {
    const filePath = join(rootDir, 'memory', 'rag-cli.jsonl');
    const memoryResult = await createLocalMemoryPlugin({
      enabled: true,
      filePath,
      maxContextChars: 2000,
      topK: 2,
    });
    const readerProvider = new FakeProvider();
    const harness = createHarness({
      plugins: [memoryResult.plugin!],
      providerInstance: readerProvider,
      session: new Session({
        id: 'memory-reader-session',
        store: new MemorySessionStore(),
      }),
      systemPrompt: 'You are a helpful assistant.',
      tools: [],
    });

    await writeFile(
      filePath,
      [
        'not-json',
        JSON.stringify({
          content: 'User: I prefer concise answers about payments.\nAssistant: reply',
          createdAt: '2026-04-19T18:00:00.000Z',
          id: 'turn-1',
          model: 'fake-model',
          sessionId: 'memory-writer-session',
          turnId: 'turn-1',
        }),
      ].join('\n'),
      'utf8',
    );

    const reply = await harness.sendMessage('What do I prefer about payments?');

    assert.equal(reply.content, 'reply:What do I prefer about payments?');
    assert.match(readerProvider.requests[0]?.messages[0]?.content ?? '', /local-memory:memory-writer-session/);
    assert.match(readerProvider.requests[0]?.messages[0]?.content ?? '', /concise answers about payments/);
  });
});

test('createLocalMemoryPlugin propagates aborts while local recall is running', async () => {
  await withTempDir(async (rootDir) => {
    const filePath = join(rootDir, 'memory', 'rag-cli.jsonl');
    const memoryResult = await createLocalMemoryPlugin({
      enabled: true,
      filePath,
      maxContextChars: 2000,
      topK: 2,
    });
    const records = Array.from({ length: 2000 }, (_, index) => ({
      content: `User: preference ${index} about payments\nAssistant: reply ${index}`,
      createdAt: `2026-04-19T18:00:${String(index % 60).padStart(2, '0')}.000Z`,
      id: `turn-${index}`,
      model: 'fake-model',
      sessionId: 'memory-writer-session',
      turnId: `turn-${index}`,
    }));

    await writeFile(filePath, records.map((record) => JSON.stringify(record)).join('\n'), 'utf8');

    const controller = new AbortController();
    const harness = createHarness({
      plugins: [memoryResult.plugin!],
      providerInstance: new FakeProvider(),
      session: new Session({
        id: 'memory-reader-session',
        store: new MemorySessionStore(),
      }),
      systemPrompt: 'You are a helpful assistant.',
      tools: [],
    });

    const pendingReply = harness.sendMessage('What do I prefer about payments?', { signal: controller.signal });
    controller.abort();

    await assert.rejects(
      async () => {
        await pendingReply;
      },
      { name: 'AbortError' },
    );
    assert.equal(harness.session.messages.length, 0);
  });
});

test('createLocalMemoryPlugin recalls Unicode memory content', async () => {
  await withTempDir(async (rootDir) => {
    const filePath = join(rootDir, 'memory', 'rag-cli.jsonl');
    const memoryResult = await createLocalMemoryPlugin({
      enabled: true,
      filePath,
      maxContextChars: 2000,
      topK: 2,
    });
    const provider = new FakeProvider();
    const harness = createHarness({
      plugins: [memoryResult.plugin!],
      providerInstance: provider,
      session: new Session({
        id: 'memory-reader-session',
        store: new MemorySessionStore(),
      }),
      systemPrompt: 'You are a helpful assistant.',
      tools: [],
    });

    await writeFile(
      filePath,
      JSON.stringify({
        content: 'User: Я люблю платежи\nAssistant: Хорошо, запомнил про платежи.',
        createdAt: '2026-04-19T18:00:00.000Z',
        id: 'turn-1',
        model: 'fake-model',
        sessionId: 'memory-writer-session',
        turnId: 'turn-1',
      }),
      'utf8',
    );

    await harness.sendMessage('платежи');

    assert.match(provider.requests[0]?.messages[0]?.content ?? '', /Я люблю платежи/);
  });
});

async function waitForMemoryWrite(filePath: string, pattern: RegExp): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const contents = await readFile(filePath, 'utf8');

    if (pattern.test(contents)) {
      return;
    }

    await delay(10);
  }

  throw new Error(`Timed out waiting for memory write in ${filePath}.`);
}
