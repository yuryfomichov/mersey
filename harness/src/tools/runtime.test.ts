import assert from 'node:assert/strict';
import test from 'node:test';

import { withTempDir, writeWorkspaceFiles } from '../../test/test-helpers.js';
import { ReadFileTool } from './read-file.js';
import { createToolRuntime } from './services/index.js';

test('executeToolCall returns an error result for unknown tools', async () => {
  const result = await createToolRuntime({
    policy: { workspaceRoot: process.cwd() },
    tools: [new ReadFileTool()],
  }).executeToolCall({
    id: 'call-1',
    input: { path: 'note.txt' },
    name: 'missing_tool',
  });

  assert.equal(result.isError, true);
  assert.equal(result.content, 'Unknown tool: missing_tool');
});

test('executeToolCall wraps tool execution errors', async () => {
  const result = await createToolRuntime({
    policy: { workspaceRoot: process.cwd() },
    tools: [new ReadFileTool()],
  }).executeToolCall({
    id: 'call-1',
    input: {},
    name: 'read_file',
  });

  assert.equal(result.isError, true);
  assert.equal(result.content, 'read_file requires a string path.');
});

test('executeToolCall returns tool results with tool metadata', async () => {
  await withTempDir(async (rootDir) => {
    await writeWorkspaceFiles(rootDir, { 'note.txt': 'hello from file' });

    const result = await createToolRuntime({
      policy: { workspaceRoot: rootDir },
      tools: [new ReadFileTool()],
    }).executeToolCall({
      id: 'call-1',
      input: { path: 'note.txt' },
      name: 'read_file',
    });

    assert.equal(result.isError, undefined);
    assert.equal(result.name, 'read_file');
    assert.equal(result.toolCallId, 'call-1');
    assert.equal(result.content, 'hello from file');
  });
});
