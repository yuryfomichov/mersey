import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { WriteFileTool } from './index.js';

test('WriteFileTool writes files relative to the workspace root', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'mersey-'));

  try {
    const tool = new WriteFileTool({ workspaceRoot: rootDir });

    const result = await tool.execute({ content: 'hello from write', path: 'notes/note.txt' });
    const content = await readFile(join(rootDir, 'notes/note.txt'), 'utf8');

    assert.equal(content, 'hello from write');
    assert.match(result.replaceAll('\\', '/'), /^Wrote file: .*notes\/note\.txt$/);
  } finally {
    await rm(rootDir, { force: true, recursive: true });
  }
});

test('WriteFileTool refuses to overwrite existing files by default', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'mersey-'));

  try {
    await mkdir(join(rootDir, 'notes'), { recursive: true });
    await writeFile(join(rootDir, 'notes/note.txt'), 'existing', 'utf8');

    const tool = new WriteFileTool({ workspaceRoot: rootDir });

    await assert.rejects(
      () => tool.execute({ content: 'replacement', path: 'notes/note.txt' }),
      /write_file refuses to overwrite existing files/,
    );
    assert.equal(await readFile(join(rootDir, 'notes/note.txt'), 'utf8'), 'existing');
  } finally {
    await rm(rootDir, { force: true, recursive: true });
  }
});

test('WriteFileTool overwrites existing files when overwrite is true', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'mersey-'));

  try {
    await mkdir(join(rootDir, 'notes'), { recursive: true });
    await writeFile(join(rootDir, 'notes/note.txt'), 'existing', 'utf8');

    const tool = new WriteFileTool({ workspaceRoot: rootDir });

    await tool.execute({ content: 'replacement', overwrite: true, path: 'notes/note.txt' });

    assert.equal(await readFile(join(rootDir, 'notes/note.txt'), 'utf8'), 'replacement');
  } finally {
    await rm(rootDir, { force: true, recursive: true });
  }
});

test('WriteFileTool rejects paths outside the workspace root', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'mersey-'));
  const workspaceRoot = join(rootDir, 'workspace');

  try {
    await mkdir(workspaceRoot);

    const tool = new WriteFileTool({ workspaceRoot });

    await assert.rejects(
      () => tool.execute({ content: 'top secret', path: '../secret.txt' }),
      /write_file path must stay inside workspace root/,
    );
    await assert.rejects(
      () => tool.execute({ content: 'top secret', path: join(rootDir, 'secret.txt') }),
      /write_file path must stay inside workspace root/,
    );
  } finally {
    await rm(rootDir, { force: true, recursive: true });
  }
});

test('WriteFileTool rejects symlinked paths that escape the workspace root', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'mersey-'));
  const workspaceRoot = join(rootDir, 'workspace');
  const outsideRoot = join(rootDir, 'outside');

  try {
    await mkdir(workspaceRoot);
    await mkdir(outsideRoot);

    const tool = new WriteFileTool({ workspaceRoot });

    await symlink(outsideRoot, join(workspaceRoot, 'linked'), 'dir');

    await assert.rejects(
      () => tool.execute({ content: 'top secret', path: 'linked/secret.txt' }),
      /write_file path must stay inside workspace root/,
    );
  } finally {
    await rm(rootDir, { force: true, recursive: true });
  }
});

test('WriteFileTool validates path and content inputs', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'mersey-'));

  try {
    const tool = new WriteFileTool({ workspaceRoot: rootDir });

    await assert.rejects(() => tool.execute({ content: 'hello' }), /write_file requires a string path/);
    await assert.rejects(() => tool.execute({ path: 'note.txt' }), /write_file requires string content/);
  } finally {
    await rm(rootDir, { force: true, recursive: true });
  }
});
