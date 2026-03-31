import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createToolContext, EditFileTool } from './index.js';

test('EditFileTool replaces exactly one matching string', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'mersey-'));

  try {
    await writeFile(join(rootDir, 'note.txt'), 'hello world', 'utf8');

    const tool = new EditFileTool();
    const result = await tool.execute(
      { newText: 'mersey', oldText: 'world', path: 'note.txt' },
      createToolContext({ workspaceRoot: rootDir }),
    );
    const content = await readFile(join(rootDir, 'note.txt'), 'utf8');

    assert.equal(content, 'hello mersey');
    assert.equal(typeof result, 'object');
    assert.match(result.content, /^Edited file: .*note\.txt$/);
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

    const tool = new EditFileTool();

    await assert.rejects(
      () =>
        tool.execute({ newText: 'public', oldText: 'secret', path: '../secret.txt' }, createToolContext({ workspaceRoot })),
      /edit_file path must stay inside workspace root/,
    );
    await assert.rejects(
      () =>
        tool.execute({ newText: 'public', oldText: 'secret', path: outsidePath }, createToolContext({ workspaceRoot })),
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

    const tool = new EditFileTool();

    await assert.rejects(
      () =>
        tool.execute(
          { newText: 'mersey', oldText: 'missing', path: 'note.txt' },
          createToolContext({ workspaceRoot: rootDir }),
        ),
      /edit_file could not find oldText in file/,
    );
    await assert.rejects(
      () =>
        tool.execute(
          { newText: 'mersey', oldText: 'world', path: 'note.txt' },
          createToolContext({ workspaceRoot: rootDir }),
        ),
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

    const tool = new EditFileTool();

    await assert.rejects(
      () => tool.execute({ newText: 'b', oldText: 'aa', path: 'note.txt' }, createToolContext({ workspaceRoot: rootDir })),
      /edit_file requires oldText to match exactly once/,
    );
  } finally {
    await rm(rootDir, { force: true, recursive: true });
  }
});

test('EditFileTool validates path and text inputs', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'mersey-'));

  try {
    const tool = new EditFileTool();

    await assert.rejects(
      () => tool.execute({ newText: 'mersey', oldText: 'world' }, createToolContext({ workspaceRoot: rootDir })),
      /edit_file requires a string path/,
    );
    await assert.rejects(
      () => tool.execute({ newText: 'mersey', path: 'note.txt' }, createToolContext({ workspaceRoot: rootDir })),
      /edit_file requires string oldText/,
    );
    await assert.rejects(
      () => tool.execute({ oldText: 'world', path: 'note.txt' }, createToolContext({ workspaceRoot: rootDir })),
      /edit_file requires string newText/,
    );
    await assert.rejects(
      () =>
        tool.execute({ newText: 'mersey', oldText: '', path: 'note.txt' }, createToolContext({ workspaceRoot: rootDir })),
      /edit_file requires a non-empty oldText/,
    );
  } finally {
    await rm(rootDir, { force: true, recursive: true });
  }
});

test('EditFileTool rejects denylisted writes from shared policy', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'mersey-'));

  try {
    await writeFile(join(rootDir, '.env'), 'SECRET=1', 'utf8');

    const tool = new EditFileTool();

    await assert.rejects(
      () =>
        tool.execute(
          { newText: 'SECRET=2', oldText: 'SECRET=1', path: '.env' },
          createToolContext({
            pathDenylist: [{ access: ['write'], basename: '.env', reason: 'sensitive file' }],
            workspaceRoot: rootDir,
          }),
        ),
      /edit_file path is blocked by tool policy: \.env \(sensitive file\)/,
    );
  } finally {
    await rm(rootDir, { force: true, recursive: true });
  }
});

test('EditFileTool rejects files blocked for read access by shared policy', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'mersey-'));

  try {
    await writeFile(join(rootDir, 'note.txt'), 'hello world', 'utf8');

    const tool = new EditFileTool();

    await assert.rejects(
      () =>
        tool.execute(
          { newText: 'hello mersey', oldText: 'hello world', path: 'note.txt' },
          createToolContext({
            pathDenylist: [{ access: ['read'], basename: 'note.txt', reason: 'read blocked' }],
            workspaceRoot: rootDir,
          }),
        ),
      /edit_file path is blocked by tool policy: note\.txt \(read blocked\)/,
    );
  } finally {
    await rm(rootDir, { force: true, recursive: true });
  }
});
