import assert from 'node:assert/strict';
import test from 'node:test';

import { ReadFileTool } from '../../tools/read-file.js';
import { withTempDir, writeWorkspaceFiles } from '../test/test-helpers.js';
import { createToolRuntime } from './runtime/index.js';

test('executeToolCall returns an error result for unknown tools', async () => {
  const result = await createToolRuntime({
    tools: [new ReadFileTool({ policy: { workspaceRoot: process.cwd() } })],
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
    tools: [new ReadFileTool({ policy: { workspaceRoot: process.cwd() } })],
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
      tools: [new ReadFileTool({ policy: { workspaceRoot: rootDir } })],
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

test('createToolRuntime rejects duplicate tool names', () => {
  assert.throws(
    () =>
      createToolRuntime({
        tools: [
          new ReadFileTool({ policy: { workspaceRoot: process.cwd() } }),
          new ReadFileTool({ policy: { workspaceRoot: process.cwd() } }),
        ],
      }),
    /Duplicate tool name registered: read_file/,
  );
});
