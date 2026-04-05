import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { ReadFileTool } from './read-file.js';
import type { ToolExecutionContext } from './services/index.js';

function createToolExecutionContext(): ToolExecutionContext {
  return {
    cancellation: {
      signal: () => undefined,
      throwIfAborted: () => {},
    },
  };
}

test('ReadFileTool reads files relative to the workspace root', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'mersey-'));

  try {
    await writeFile(join(rootDir, 'note.txt'), 'hello from file', 'utf8');

    const tool = new ReadFileTool({ policy: { workspaceRoot: rootDir } });
    const result = await tool.execute({ path: 'note.txt' }, createToolExecutionContext());

    assert.equal(typeof result, 'object');
    assert.equal(result.content, 'hello from file');
    assert.deepEqual(result.data && 'truncated' in result.data ? result.data.truncated : undefined, false);
    assert.match(String(result.data && 'path' in result.data ? result.data.path : ''), /note\.txt$/);
  } finally {
    await rm(rootDir, { force: true, recursive: true });
  }
});

test('ReadFileTool allows in-workspace paths that start with two dots', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'mersey-'));

  try {
    await writeFile(join(rootDir, '..note.txt'), 'hidden but valid', 'utf8');

    const tool = new ReadFileTool({ policy: { workspaceRoot: rootDir } });
    const result = await tool.execute({ path: '..note.txt' }, createToolExecutionContext());

    assert.equal(typeof result, 'object');
    assert.equal(result.content, 'hidden but valid');
  } finally {
    await rm(rootDir, { force: true, recursive: true });
  }
});

test('ReadFileTool truncates large output to the shared result limit', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'mersey-'));

  try {
    await writeFile(join(rootDir, 'note.txt'), 'abcdef', 'utf8');

    const tool = new ReadFileTool({ policy: { maxToolResultBytes: 4, workspaceRoot: rootDir } });
    const result = await tool.execute({ path: 'note.txt' }, createToolExecutionContext());

    assert.equal(typeof result, 'object');
    assert.equal(result.content, 'abcd');
    assert.deepEqual(result.data && 'truncated' in result.data ? result.data.truncated : undefined, true);
    assert.match(String(result.data && 'path' in result.data ? result.data.path : ''), /note\.txt$/);
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

    const tool = new ReadFileTool({ policy: { workspaceRoot } });

    await assert.rejects(
      () => tool.execute({ path: '../secret.txt' }, createToolExecutionContext()),
      /read_file path must stay inside workspace root/,
    );
    await assert.rejects(
      () => tool.execute({ path: outsidePath }, createToolExecutionContext()),
      /read_file path must stay inside workspace root/,
    );
    await assert.rejects(
      () => tool.execute({ path: '../missing.txt' }, createToolExecutionContext()),
      /read_file path must stay inside workspace root/,
    );
  } finally {
    await rm(rootDir, { force: true, recursive: true });
  }
});

test('ReadFileTool rejects files larger than the shared policy limit', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'mersey-'));

  try {
    await writeFile(join(rootDir, 'large.txt'), '1234567890', 'utf8');

    const tool = new ReadFileTool({ policy: { maxReadBytes: 4, workspaceRoot: rootDir } });

    await assert.rejects(
      () => tool.execute({ path: 'large.txt' }, createToolExecutionContext()),
      /read_file refuses files larger than 4 bytes/,
    );
  } finally {
    await rm(rootDir, { force: true, recursive: true });
  }
});

test('ReadFileTool rejects denylisted paths from shared policy', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'mersey-'));

  try {
    await writeFile(join(rootDir, '.env'), 'SECRET=1', 'utf8');

    const tool = new ReadFileTool({
      policy: {
        pathDenylist: [{ basename: '.env', reason: 'sensitive file' }],
        workspaceRoot: rootDir,
      },
    });

    await assert.rejects(
      () => tool.execute({ path: '.env' }, createToolExecutionContext()),
      /read_file path is blocked by tool policy: \.env \(sensitive file\)/,
    );
  } finally {
    await rm(rootDir, { force: true, recursive: true });
  }
});
