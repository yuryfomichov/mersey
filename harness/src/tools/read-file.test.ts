import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { executeToolCall, getToolMap, ReadFileTool } from './index.js';

test('ReadFileTool reads files relative to the workspace root', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'mersey-'));

  try {
    await writeFile(join(rootDir, 'note.txt'), 'hello from file', 'utf8');

    const tool = new ReadFileTool({ workspaceRoot: rootDir });
    const content = await tool.execute({ path: 'note.txt' });

    assert.equal(content, 'hello from file');
  } finally {
    await rm(rootDir, { force: true, recursive: true });
  }
});

test('ReadFileTool rejects paths outside the workspace root', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'mersey-'));
  const workspaceRoot = join(rootDir, 'workspace');
  const outsidePath = join(rootDir, 'secret.txt');

  try {
    await mkdir(workspaceRoot);
    await writeFile(outsidePath, 'top secret', 'utf8');

    const tool = new ReadFileTool({ workspaceRoot });

    await assert.rejects(
      () => tool.execute({ path: '../secret.txt' }),
      /read_file path must stay inside workspace root/,
    );
    await assert.rejects(() => tool.execute({ path: outsidePath }), /read_file path must stay inside workspace root/);
    await assert.rejects(
      () => tool.execute({ path: '../missing.txt' }),
      /read_file path must stay inside workspace root/,
    );
  } finally {
    await rm(rootDir, { force: true, recursive: true });
  }
});

test('ReadFileTool rejects files larger than the configured limit', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'mersey-'));

  try {
    await writeFile(join(rootDir, 'large.txt'), '1234567890', 'utf8');

    const tool = new ReadFileTool({ maxBytes: 4, workspaceRoot: rootDir });

    await assert.rejects(() => tool.execute({ path: 'large.txt' }), /read_file refuses files larger than 4 bytes/);
  } finally {
    await rm(rootDir, { force: true, recursive: true });
  }
});

test('executeToolCall returns an error result for unknown tools', async () => {
  const result = await executeToolCall(
    {
      id: 'call-1',
      input: { path: 'note.txt' },
      name: 'missing_tool',
    },
    getToolMap([new ReadFileTool({ workspaceRoot: process.cwd() })]),
  );

  assert.equal(result.isError, true);
  assert.equal(result.content, 'Unknown tool: missing_tool');
});

test('executeToolCall wraps tool execution errors', async () => {
  const result = await executeToolCall(
    {
      id: 'call-1',
      input: {},
      name: 'read_file',
    },
    getToolMap([new ReadFileTool({ workspaceRoot: process.cwd() })]),
  );

  assert.equal(result.isError, true);
  assert.equal(result.content, 'read_file requires a string path.');
});
