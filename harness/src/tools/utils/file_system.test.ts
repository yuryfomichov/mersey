import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { assertFileSizeWithinLimit, resolvePathInWorkspace } from './file_system.js';

test('resolvePathInWorkspace resolves relative paths inside the workspace', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'mersey-'));

  try {
    await writeFile(join(rootDir, 'note.txt'), 'hello', 'utf8');

    const resolvedPath = await resolvePathInWorkspace('note.txt', rootDir, { toolName: 'test_tool' });

    assert.match(resolvedPath, /note\.txt$/);
  } finally {
    await rm(rootDir, { force: true, recursive: true });
  }
});

test('resolvePathInWorkspace allows missing paths inside the workspace when allowMissing is enabled', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'mersey-'));

  try {
    const resolvedPath = await resolvePathInWorkspace('notes/new.txt', rootDir, {
      allowMissing: true,
      toolName: 'test_tool',
    });

    assert.match(resolvedPath, /notes\/new\.txt$/);
  } finally {
    await rm(rootDir, { force: true, recursive: true });
  }
});

test('resolvePathInWorkspace rejects paths outside the workspace root', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'mersey-'));
  const workspaceRoot = join(rootDir, 'workspace');

  try {
    await mkdir(workspaceRoot);

    await assert.rejects(
      () => resolvePathInWorkspace('../secret.txt', workspaceRoot, { allowMissing: true, toolName: 'test_tool' }),
      /test_tool path must stay inside workspace root/,
    );
  } finally {
    await rm(rootDir, { force: true, recursive: true });
  }
});

test('resolvePathInWorkspace rejects symlinked paths that escape the workspace root', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'mersey-'));
  const workspaceRoot = join(rootDir, 'workspace');
  const outsideRoot = join(rootDir, 'outside');

  try {
    await mkdir(workspaceRoot);
    await mkdir(outsideRoot);
    await symlink(outsideRoot, join(workspaceRoot, 'linked'), 'dir');

    await assert.rejects(
      () =>
        resolvePathInWorkspace('linked/secret.txt', workspaceRoot, {
          allowMissing: true,
          toolName: 'test_tool',
        }),
      /test_tool path must stay inside workspace root/,
    );
  } finally {
    await rm(rootDir, { force: true, recursive: true });
  }
});

test('assertFileSizeWithinLimit allows files within the size limit', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'mersey-'));

  try {
    const filePath = join(rootDir, 'note.txt');
    await writeFile(filePath, '1234', 'utf8');

    await assert.doesNotReject(() => assertFileSizeWithinLimit(filePath, 4, 'test_tool'));
  } finally {
    await rm(rootDir, { force: true, recursive: true });
  }
});

test('assertFileSizeWithinLimit rejects files over the size limit', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'mersey-'));

  try {
    const filePath = join(rootDir, 'note.txt');
    await writeFile(filePath, '12345', 'utf8');

    await assert.rejects(
      () => assertFileSizeWithinLimit(filePath, 4, 'test_tool'),
      /test_tool refuses files larger than 4 bytes/,
    );
  } finally {
    await rm(rootDir, { force: true, recursive: true });
  }
});
