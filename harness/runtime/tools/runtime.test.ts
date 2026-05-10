import assert from 'node:assert/strict';
import test from 'node:test';

import { ReadFileTool } from '../../tools/read-file.js';
import { withTempDir, writeWorkspaceFiles } from '../test/test-helpers.js';
import { createStaticToolCatalog } from './runtime/index.js';

test('tool catalog resolves unknown tools to null', async () => {
  const snapshot = await createStaticToolCatalog({
    tools: [new ReadFileTool({ policy: { workspaceRoot: process.cwd() } })],
  }).snapshot({ iteration: 1, sessionId: 'session', turnId: 'turn' });

  assert.equal(
    snapshot.resolve({
      id: 'call-1',
      input: { path: 'note.txt' },
      name: 'missing_tool',
    }),
    null,
  );
});

test('tool catalog wraps tool execution errors', async () => {
  const snapshot = await createStaticToolCatalog({
    tools: [new ReadFileTool({ policy: { workspaceRoot: process.cwd() } })],
  }).snapshot({ iteration: 1, sessionId: 'session', turnId: 'turn' });
  assert.equal(snapshot.descriptors[0]?.definition.name, 'workspace_read_file');
  assert.equal(snapshot.descriptors[0]?.identity.originalName, 'workspace.read_file');
  assert.equal(snapshot.descriptors[0]?.identity.publicName, 'workspace_read_file');

  const resolved = snapshot.resolve({
    id: 'call-1',
    input: {},
    name: 'workspace_read_file',
  });
  assert.ok(resolved);

  const result = await snapshot.execute(resolved, {
    cancellation: {
      signal: () => undefined,
      throwIfAborted() {},
    },
  });

  assert.equal(result.isError, true);
  assert.equal(result.parts[0]?.type, 'text');
  assert.match(result.parts[0]?.type === 'text' ? result.parts[0].text : '', /requires a string path/);
});

test('tool catalog returns structured results and stable tool identity', async () => {
  await withTempDir(async (rootDir) => {
    await writeWorkspaceFiles(rootDir, { 'note.txt': 'hello from file' });

    const snapshot = await createStaticToolCatalog({
      sourceId: 'local-tools',
      tools: [new ReadFileTool({ policy: { workspaceRoot: rootDir } })],
    }).snapshot({ iteration: 1, sessionId: 'session', turnId: 'turn' });
    const resolved = snapshot.resolve({
      id: 'call-1',
      input: { path: 'note.txt' },
      name: 'workspace_read_file',
    });
    assert.ok(resolved);
    assert.equal(resolved.originalName, 'workspace.read_file');
    assert.equal(resolved.publicName, 'workspace_read_file');
    assert.equal(resolved.toolId, 'local-tools:workspace.read_file');

    const result = await snapshot.execute(resolved, {
      cancellation: {
        signal: () => undefined,
        throwIfAborted() {},
      },
    });

    assert.equal(result.isError, undefined);
    assert.equal(result.parts[0]?.type, 'text');
    assert.equal(result.parts[0]?.type === 'text' ? result.parts[0].text : '', 'hello from file');
    assert.equal(result.metadata?.path?.toString().endsWith('note.txt'), true);
  });
});

test('static tool catalog rejects duplicate tool names', () => {
  assert.throws(
    () =>
      createStaticToolCatalog({
        tools: [
          new ReadFileTool({ policy: { workspaceRoot: process.cwd() } }),
          new ReadFileTool({ policy: { workspaceRoot: process.cwd() } }),
        ],
      }),
    /Duplicate tool name registered: workspace.read_file/,
  );
});
