import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createToolContext, WriteFileTool } from './index.js';

test('WriteFileTool writes files relative to the workspace root', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'mersey-'));

  try {
    const tool = new WriteFileTool();

    const result = await tool.execute(
      { content: 'hello from write', path: 'notes/note.txt' },
      createToolContext({ workspaceRoot: rootDir }),
    );
    const content = await readFile(join(rootDir, 'notes/note.txt'), 'utf8');

    assert.equal(content, 'hello from write');
    assert.equal(typeof result, 'object');
    assert.match(result.content.replaceAll('\\', '/'), /^Wrote file: .*notes\/note\.txt$/);
    assert.equal(result.data && 'overwritten' in result.data ? result.data.overwritten : undefined, false);
  } finally {
    await rm(rootDir, { force: true, recursive: true });
  }
});

test('WriteFileTool refuses to overwrite existing files by default', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'mersey-'));

  try {
    await mkdir(join(rootDir, 'notes'), { recursive: true });
    await writeFile(join(rootDir, 'notes/note.txt'), 'existing', 'utf8');

    const tool = new WriteFileTool();

    await assert.rejects(
      () => tool.execute({ content: 'replacement', path: 'notes/note.txt' }, createToolContext({ workspaceRoot: rootDir })),
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

    const tool = new WriteFileTool();

    await tool.execute(
      { content: 'replacement', overwrite: true, path: 'notes/note.txt' },
      createToolContext({ workspaceRoot: rootDir }),
    );

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

    const tool = new WriteFileTool();

    await assert.rejects(
      () => tool.execute({ content: 'top secret', path: '../secret.txt' }, createToolContext({ workspaceRoot })),
      /write_file path must stay inside workspace root/,
    );
    await assert.rejects(
      () =>
        tool.execute({ content: 'top secret', path: join(rootDir, 'secret.txt') }, createToolContext({ workspaceRoot })),
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

    const tool = new WriteFileTool();

    await symlink(outsideRoot, join(workspaceRoot, 'linked'), 'dir');

    await assert.rejects(
      () => tool.execute({ content: 'top secret', path: 'linked/secret.txt' }, createToolContext({ workspaceRoot })),
      /write_file path must stay inside workspace root/,
    );
  } finally {
    await rm(rootDir, { force: true, recursive: true });
  }
});

test('WriteFileTool validates path and content inputs', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'mersey-'));

  try {
    const tool = new WriteFileTool();

    await assert.rejects(
      () => tool.execute({ content: 'hello' }, createToolContext({ workspaceRoot: rootDir })),
      /write_file requires a string path/,
    );
    await assert.rejects(
      () => tool.execute({ path: 'note.txt' }, createToolContext({ workspaceRoot: rootDir })),
      /write_file requires string content/,
    );
  } finally {
    await rm(rootDir, { force: true, recursive: true });
  }
});

test('WriteFileTool rejects content larger than the shared policy limit', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'mersey-'));

  try {
    const tool = new WriteFileTool();

    await assert.rejects(
      () => tool.execute({ content: '12345', path: 'note.txt' }, createToolContext({ maxWriteBytes: 4, workspaceRoot: rootDir })),
      /write_file refuses content larger than 4 bytes/,
    );
  } finally {
    await rm(rootDir, { force: true, recursive: true });
  }
});

test('WriteFileTool supports tool-specific denylist rules in shared policy', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'mersey-'));

  try {
    const tool = new WriteFileTool();

    await assert.rejects(
      () =>
        tool.execute(
          { content: 'SECRET=1', path: '.env' },
          createToolContext({
            pathDenylist: [{ basename: '.env', reason: 'sensitive file', tools: ['write_file'] }],
            workspaceRoot: rootDir,
          }),
        ),
      /write_file path is blocked by tool policy: \.env \(sensitive file\)/,
    );
  } finally {
    await rm(rootDir, { force: true, recursive: true });
  }
});
