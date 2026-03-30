import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { EditFileTool } from './index.js';

test('EditFileTool replaces exactly one matching string', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'mersey-'));

  try {
    await writeFile(join(rootDir, 'note.txt'), 'hello world', 'utf8');

    const tool = new EditFileTool({ workspaceRoot: rootDir });
    const result = await tool.execute({ newText: 'mersey', oldText: 'world', path: 'note.txt' });
    const content = await readFile(join(rootDir, 'note.txt'), 'utf8');

    assert.equal(content, 'hello mersey');
    assert.match(result, /^Edited file: .*note\.txt$/);
  } finally {
    await rm(rootDir, { force: true, recursive: true });
  }
});

test('EditFileTool rejects paths outside the workspace root', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'mersey-'));
  const workspaceRoot = join(rootDir, 'workspace');
  const outsidePath = join(rootDir, 'secret.txt');

  try {
    await writeFile(outsidePath, 'top secret', 'utf8');
    await mkdir(workspaceRoot);

    const tool = new EditFileTool({ workspaceRoot });

    await assert.rejects(
      () => tool.execute({ newText: 'public', oldText: 'secret', path: '../secret.txt' }),
      /edit_file path must stay inside workspace root/,
    );
    await assert.rejects(
      () => tool.execute({ newText: 'public', oldText: 'secret', path: outsidePath }),
      /edit_file path must stay inside workspace root/,
    );
  } finally {
    await rm(rootDir, { force: true, recursive: true });
  }
});

test('EditFileTool requires oldText to match exactly once', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'mersey-'));

  try {
    await writeFile(join(rootDir, 'note.txt'), 'hello world world', 'utf8');

    const tool = new EditFileTool({ workspaceRoot: rootDir });

    await assert.rejects(
      () => tool.execute({ newText: 'mersey', oldText: 'missing', path: 'note.txt' }),
      /edit_file could not find oldText in file/,
    );
    await assert.rejects(
      () => tool.execute({ newText: 'mersey', oldText: 'world', path: 'note.txt' }),
      /edit_file requires oldText to match exactly once/,
    );
  } finally {
    await rm(rootDir, { force: true, recursive: true });
  }
});

test('EditFileTool rejects overlapping oldText matches', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'mersey-'));

  try {
    await writeFile(join(rootDir, 'note.txt'), 'aaa', 'utf8');

    const tool = new EditFileTool({ workspaceRoot: rootDir });

    await assert.rejects(
      () => tool.execute({ newText: 'b', oldText: 'aa', path: 'note.txt' }),
      /edit_file requires oldText to match exactly once/,
    );
  } finally {
    await rm(rootDir, { force: true, recursive: true });
  }
});

test('EditFileTool validates path and text inputs', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'mersey-'));

  try {
    const tool = new EditFileTool({ workspaceRoot: rootDir });

    await assert.rejects(
      () => tool.execute({ newText: 'mersey', oldText: 'world' }),
      /edit_file requires a string path/,
    );
    await assert.rejects(
      () => tool.execute({ newText: 'mersey', path: 'note.txt' }),
      /edit_file requires string oldText/,
    );
    await assert.rejects(
      () => tool.execute({ oldText: 'world', path: 'note.txt' }),
      /edit_file requires string newText/,
    );
    await assert.rejects(
      () => tool.execute({ newText: 'mersey', oldText: '', path: 'note.txt' }),
      /edit_file requires a non-empty oldText/,
    );
  } finally {
    await rm(rootDir, { force: true, recursive: true });
  }
});
