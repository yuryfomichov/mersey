import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';

import { createHarness } from '../../../harness/index.js';
import { FakeProvider } from '../../../harness/providers/index.js';
import { withTempDir, writeWorkspaceFiles } from '../../../harness/runtime/test/test-helpers.js';
import { MemorySessionStore, Session } from '../../../harness/sessions/index.js';
import { createMarkdownRagPlugin, getDefaultAppDataDir, getMarkdownRagDefinition } from './rag.js';

test('getMarkdownRagDefinition uses rag-cli defaults and parses rag flags', () => {
  const definition = getMarkdownRagDefinition(['--rag', '--rag-top-k=2'], {
    cwd: '/workspace/mersey',
    defaultIndexDir: 'tmp/rag/custom-index',
  });

  assert.deepEqual(definition, {
    enabled: true,
    indexDir: '/workspace/mersey/tmp/rag/custom-index',
    maxContextChars: 2000,
    rebuildIndex: false,
    sourceDir: '/workspace/mersey/apps/rag-cli/data',
    topK: 2,
  });
  assert.equal(getDefaultAppDataDir('/workspace/mersey'), '/workspace/mersey/apps/rag-cli/data');
});

test('getMarkdownRagDefinition parses rebuild flag', () => {
  const definition = getMarkdownRagDefinition(['--rag', '--rebuild-rag'], {
    cwd: '/workspace/mersey',
  });

  assert.equal(definition.rebuildIndex, true);
});

test('getMarkdownRagDefinition validates rag numeric flags', () => {
  assert.throws(() => getMarkdownRagDefinition(['--rag', '--rag-top-k=-1']), /--rag-top-k must be a positive integer/);
  assert.throws(() => getMarkdownRagDefinition(['--rag', '--rag-top-k=0']), /--rag-top-k must be a positive integer/);
  assert.throws(
    () => getMarkdownRagDefinition(['--rag', '--rag-top-k=']),
    /Invalid value for --rag-top-k: value is required/,
  );
  assert.throws(
    () => getMarkdownRagDefinition(['--rag', '--rag-max-context-chars=0']),
    /--rag-max-context-chars must be a positive integer/,
  );
  assert.throws(
    () => getMarkdownRagDefinition(['--rag', '--rag-max-context-chars=']),
    /Invalid value for --rag-max-context-chars: value is required/,
  );
});

test('createMarkdownRagPlugin disables RAG cleanly when the data path is missing', async () => {
  const ragResult = await createMarkdownRagPlugin({
    enabled: true,
    indexDir: '/workspace/mersey/tmp/rag/missing-index',
    maxContextChars: 2000,
    rebuildIndex: false,
    sourceDir: '/workspace/mersey/data-that-does-not-exist',
    topK: 1,
  });

  assert.equal(ragResult.plugin, null);
  assert.deepEqual(ragResult.summaryLines, [
    'rag: disabled (data path not found)',
    'rag source: /workspace/mersey/data-that-does-not-exist',
  ]);
});

test('createMarkdownRagPlugin disables RAG cleanly when markdown files contain no content', async () => {
  await withTempDir(async (rootDir) => {
    const sourceDir = join(rootDir, 'data');

    await writeWorkspaceFiles(rootDir, {
      'data/empty.md': '   \n\n   ',
    });

    const ragResult = await createMarkdownRagPlugin({
      enabled: true,
      indexDir: join(rootDir, 'rag-index'),
      maxContextChars: 2000,
      rebuildIndex: false,
      sourceDir,
      topK: 1,
    });

    assert.equal(ragResult.plugin, null);
    assert.deepEqual(ragResult.summaryLines, ['rag: disabled (no markdown content found)', `rag source: ${sourceDir}`]);
  });
});

test('createMarkdownRagPlugin indexes markdown data and injects retrieved context', async () => {
  await withTempDir(async (rootDir) => {
    const sourceDir = join(rootDir, 'data');
    const indexDir = join(rootDir, 'rag-index');

    await writeWorkspaceFiles(rootDir, {
      'data/projects/payments.md': '# Payments\n\nBuilt a payments platform for global merchants.',
      'data/leadership.md': '# Leadership\n\nLed a frontend team of four engineers.',
    });

    const ragResult = await createMarkdownRagPlugin({
      enabled: true,
      indexDir,
      maxContextChars: 2000,
      rebuildIndex: true,
      sourceDir,
      topK: 1,
    });

    assert.ok(ragResult.plugin);
    assert.match(ragResult.summaryLines[0] ?? '', /rag: enabled \(2 files,.*index rebuilt\)/);

    const provider = new FakeProvider();
    const harness = createHarness({
      plugins: [ragResult.plugin!],
      providerInstance: provider,
      session: new Session({
        id: 'rag-session',
        store: new MemorySessionStore(),
      }),
      systemPrompt: 'You are a helpful assistant.',
      tools: [],
    });

    const reply = await harness.sendMessage('payments');

    assert.equal(reply.content, 'reply:payments');
    assert.equal(provider.requests.length, 1);
    assert.equal(provider.requests[0]?.messages.length, 2);
    assert.match(provider.requests[0]?.messages[0]?.content ?? '', /projects\/payments\.md/);
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

test('createMarkdownRagPlugin reuses an existing index until rebuild is requested', async () => {
  await withTempDir(async (rootDir) => {
    const sourceDir = join(rootDir, 'data');
    const indexDir = join(rootDir, 'rag-index');
    const missingSourceDir = join(rootDir, 'missing-data');

    await writeWorkspaceFiles(rootDir, {
      'data/profile.md': '# Profile\n\nBuilt a payments platform for global merchants.',
    });

    await createMarkdownRagPlugin({
      enabled: true,
      indexDir,
      maxContextChars: 2000,
      rebuildIndex: true,
      sourceDir,
      topK: 1,
    });

    await writeWorkspaceFiles(rootDir, {
      'data/profile.md': '# Profile\n\nLed a frontend team building interview systems.',
    });

    const reused = await createMarkdownRagPlugin({
      enabled: true,
      indexDir,
      maxContextChars: 2000,
      rebuildIndex: false,
      sourceDir,
      topK: 1,
    });

    const reusedProvider = new FakeProvider();
    const reusedHarness = createHarness({
      plugins: [reused.plugin!],
      providerInstance: reusedProvider,
      session: new Session({
        id: 'reused-rag-session',
        store: new MemorySessionStore(),
      }),
      systemPrompt: 'You are a helpful assistant.',
      tools: [],
    });

    await reusedHarness.sendMessage('payments');

    assert.match(reused.summaryLines[0] ?? '', /index reused/);
    assert.match(reusedProvider.requests[0]?.messages[0]?.content ?? '', /payments platform/);
    assert.doesNotMatch(reusedProvider.requests[0]?.messages[0]?.content ?? '', /frontend team/);

    const reusedWithoutSource = await createMarkdownRagPlugin({
      enabled: true,
      indexDir,
      maxContextChars: 2000,
      rebuildIndex: false,
      sourceDir: missingSourceDir,
      topK: 1,
    });

    assert.ok(reusedWithoutSource.plugin);
    assert.match(reusedWithoutSource.summaryLines[0] ?? '', /index reused/);
    assert.equal(
      reusedWithoutSource.summaryLines[1],
      `rag source: ${missingSourceDir} (not re-read; rebuild to refresh index)`,
    );

    const missingSourceProvider = new FakeProvider();
    const missingSourceHarness = createHarness({
      plugins: [reusedWithoutSource.plugin],
      providerInstance: missingSourceProvider,
      session: new Session({
        id: 'missing-source-rag-session',
        store: new MemorySessionStore(),
      }),
      systemPrompt: 'You are a helpful assistant.',
      tools: [],
    });

    await missingSourceHarness.sendMessage('payments');

    assert.match(missingSourceProvider.requests[0]?.messages[0]?.content ?? '', /payments platform/);

    const rebuilt = await createMarkdownRagPlugin({
      enabled: true,
      indexDir,
      maxContextChars: 2000,
      rebuildIndex: true,
      sourceDir,
      topK: 1,
    });

    const rebuiltProvider = new FakeProvider();
    const rebuiltHarness = createHarness({
      plugins: [rebuilt.plugin!],
      providerInstance: rebuiltProvider,
      session: new Session({
        id: 'rebuilt-rag-session',
        store: new MemorySessionStore(),
      }),
      systemPrompt: 'You are a helpful assistant.',
      tools: [],
    });

    await rebuiltHarness.sendMessage('frontend');

    assert.match(rebuilt.summaryLines[0] ?? '', /index rebuilt/);
    assert.match(rebuiltProvider.requests[0]?.messages[0]?.content ?? '', /frontend team/);
  });
});
