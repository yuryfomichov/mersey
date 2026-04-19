import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { EditFileTool } from './edit-file.js';
import type { ToolExecutionContext } from './services/index.js';

function createToolExecutionContext(): ToolExecutionContext {
  return {
    cancellation: {
      signal: () => undefined,
      throwIfAborted: () => {},
    },
  };
}

test('EditFileTool replaces exactly one matching string', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'mersey-'));

  try {
    await writeFile(join(rootDir, 'note.txt'), 'hello world', 'utf8');

    const tool = new EditFileTool({ policy: { workspaceRoot: rootDir } });
    const result = await tool.execute(
      { newText: 'mersey', oldText: 'world', path: 'note.txt' },
      createToolExecutionContext(),
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

    const tool = new EditFileTool({ policy: { workspaceRoot } });

    await assert.rejects(
      () => tool.execute({ newText: 'public', oldText: 'secret', path: '../secret.txt' }, createToolExecutionContext()),
      /edit_file path must stay inside workspace root/,
    );
    await assert.rejects(
      () => tool.execute({ newText: 'public', oldText: 'secret', path: outsidePath }, createToolExecutionContext()),
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

    const tool = new EditFileTool({ policy: { workspaceRoot: rootDir } });

    await assert.rejects(
      () => tool.execute({ newText: 'mersey', oldText: 'missing', path: 'note.txt' }, createToolExecutionContext()),
      /edit_file could not find oldText in file/,
    );
    await assert.rejects(
      () => tool.execute({ newText: 'mersey', oldText: 'world', path: 'note.txt' }, createToolExecutionContext()),
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

    const tool = new EditFileTool({ policy: { workspaceRoot: rootDir } });

    await assert.rejects(
      () => tool.execute({ newText: 'b', oldText: 'aa', path: 'note.txt' }, createToolExecutionContext()),
      /edit_file requires oldText to match exactly once/,
    );
  } finally {
    await rm(rootDir, { force: true, recursive: true });
  }
});

test('EditFileTool validates path and text inputs', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'mersey-'));

  try {
    const tool = new EditFileTool({ policy: { workspaceRoot: rootDir } });

    await assert.rejects(
      () => tool.execute({ newText: 'mersey', oldText: 'world' }, createToolExecutionContext()),
      /edit_file requires a string path/,
    );
    await assert.rejects(
      () => tool.execute({ newText: 'mersey', path: 'note.txt' }, createToolExecutionContext()),
      /edit_file requires string oldText/,
    );
    await assert.rejects(
      () => tool.execute({ oldText: 'world', path: 'note.txt' }, createToolExecutionContext()),
      /edit_file requires string newText/,
    );
    await assert.rejects(
      () => tool.execute({ newText: 'mersey', oldText: '', path: 'note.txt' }, createToolExecutionContext()),
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

    const tool = new EditFileTool({
      policy: {
        pathDenylist: [{ access: ['write'], basename: '.env', reason: 'sensitive file' }],
        workspaceRoot: rootDir,
      },
    });

    await assert.rejects(
      () => tool.execute({ newText: 'SECRET=2', oldText: 'SECRET=1', path: '.env' }, createToolExecutionContext()),
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

    const tool = new EditFileTool({
      policy: {
        pathDenylist: [{ access: ['read'], basename: 'note.txt', reason: 'read blocked' }],
        workspaceRoot: rootDir,
      },
    });

    await assert.rejects(
      () =>
        tool.execute(
          { newText: 'hello mersey', oldText: 'hello world', path: 'note.txt' },
          createToolExecutionContext(),
        ),
      /edit_file path is blocked by tool policy: note\.txt \(read blocked\)/,
    );
  } finally {
    await rm(rootDir, { force: true, recursive: true });
  }
});

test('EditFileTool rejects symlink swaps between validation and file open', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'mersey-'));
  const outsidePath = join(rootDir, '..outside.txt');

  try {
    await writeFile(join(rootDir, 'note.txt'), 'hello world', 'utf8');
    await writeFile(outsidePath, 'outside secret', 'utf8');

    const tool = new EditFileTool({ policy: { workspaceRoot: rootDir } });
    const files = (
      tool as unknown as {
        files: {
          resolveForReadWrite(path: string, toolName: string): Promise<string>;
        };
      }
    ).files;
    const originalResolveForReadWrite = files.resolveForReadWrite.bind(files);

    files.resolveForReadWrite = async (path, toolName) => {
      const resolvedPath = await originalResolveForReadWrite(path, toolName);

      await rm(resolvedPath);
      await symlink(outsidePath, resolvedPath);

      return resolvedPath;
    };

    await assert.rejects(
      () => tool.execute({ newText: 'mersey', oldText: 'world', path: 'note.txt' }, createToolExecutionContext()),
      /ELOOP|too many symbolic links/,
    );
  } finally {
    await rm(rootDir, { force: true, recursive: true });
    await rm(outsidePath, { force: true });
  }
});
