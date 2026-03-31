import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createToolContext, RunCommandTool } from './index.js';

test('RunCommandTool executes allowlisted commands with structured result data', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'mersey-'));

  try {
    await writeFile(join(rootDir, 'note.txt'), 'hello', 'utf8');

    const tool = new RunCommandTool();
    const result = await tool.execute(
      { args: ['note.txt'], command: 'cat' },
      createToolContext({ commandAllowlist: ['cat'], workspaceRoot: rootDir }),
    );

    assert.equal(typeof result, 'object');
    assert.equal(result.isError, false);
    assert.match(result.content, /stdout:\nhello/);
    assert.deepEqual(result.data && 'command' in result.data ? result.data.command : undefined, 'cat');
    assert.deepEqual(result.data && 'exitCode' in result.data ? result.data.exitCode : undefined, 0);
  } finally {
    await rm(rootDir, { force: true, recursive: true });
  }
});

test('RunCommandTool normalizes duplicated zero-arg invocations like pwd + [pwd]', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'mersey-'));

  try {
    const tool = new RunCommandTool();
    const result = await tool.execute(
      { args: ['pwd'], command: 'pwd' },
      createToolContext({ commandAllowlist: ['pwd'], workspaceRoot: rootDir }),
    );

    assert.equal(typeof result, 'object');
    assert.equal(result.isError, false);
    assert.deepEqual(result.data && 'args' in result.data ? result.data.args : undefined, []);
    assert.match(String(result.data && 'cwd' in result.data ? result.data.cwd : ''), /mersey-/);
  } finally {
    await rm(rootDir, { force: true, recursive: true });
  }
});

test('RunCommandTool rejects commands outside the allowlist', async () => {
  const tool = new RunCommandTool();

  await assert.rejects(
    () =>
      tool.execute(
        { command: 'cat' },
        createToolContext({ commandAllowlist: ['pwd'], workspaceRoot: process.cwd() }),
      ),
    /run_command command is not in the allowlist: cat/,
  );
});

test('RunCommandTool marks non-zero exits as tool errors', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'mersey-'));

  try {
    const tool = new RunCommandTool();
    const result = await tool.execute(
      { args: ['missing-file.txt'], command: 'cat' },
      createToolContext({ commandAllowlist: ['cat'], workspaceRoot: rootDir }),
    );

    assert.equal(typeof result, 'object');
    assert.equal(result.isError, true);
    assert.match(result.content, /exitCode: 1/);
  } finally {
    await rm(rootDir, { force: true, recursive: true });
  }
});

test('RunCommandTool enforces command timeouts', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'mersey-'));

  try {
    const tool = new RunCommandTool();
    const result = await tool.execute(
      { args: ['1'], command: 'sleep', timeoutMs: 10 },
      createToolContext({ commandAllowlist: ['sleep'], workspaceRoot: rootDir }),
    );

    assert.equal(typeof result, 'object');
    assert.equal(result.isError, true);
    assert.match(result.content, /timedOut: true/);
  } finally {
    await rm(rootDir, { force: true, recursive: true });
  }
});

test('RunCommandTool truncates stdout and content separately through policy', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'mersey-'));

  try {
    const tool = new RunCommandTool();
    const result = await tool.execute(
      { args: ['abcdef'], command: 'printf' },
      createToolContext({
        commandAllowlist: ['printf'],
        maxCommandOutputBytes: 4,
        maxToolResultBytes: 80,
        workspaceRoot: rootDir,
      }),
    );

    assert.equal(typeof result, 'object');
    assert.deepEqual(result.data && 'stdout' in result.data ? result.data.stdout : undefined, 'abcd');
    assert.deepEqual(result.data && 'stdoutBytes' in result.data ? result.data.stdoutBytes : undefined, 6);
    assert.deepEqual(result.data && 'stdoutTruncated' in result.data ? result.data.stdoutTruncated : undefined, true);
  } finally {
    await rm(rootDir, { force: true, recursive: true });
  }
});

test('RunCommandTool kills processes that ignore SIGTERM after the timeout grace period', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'mersey-'));

  try {
    const tool = new RunCommandTool();
    const startedAt = Date.now();
    const result = await tool.execute(
      {
        args: ['-e', 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000);'],
        command: process.execPath,
        timeoutMs: 25,
      },
      createToolContext({ commandAllowlist: [process.execPath], workspaceRoot: rootDir }),
    );

    assert.equal(typeof result, 'object');
    assert.equal(result.isError, true);
    assert.match(result.content, /timedOut: true/);
    assert.ok(Date.now() - startedAt < 2_000);
  } finally {
    await rm(rootDir, { force: true, recursive: true });
  }
});

test('ToolContext output limiter handles zero-byte limits without hanging', () => {
  const context = createToolContext({ workspaceRoot: process.cwd() });

  assert.deepEqual(context.output.limitText('hello', 0), {
    originalBytes: 5,
    text: '',
    truncated: true,
  });
});

test('ToolContext output limiter does not leave a dangling surrogate at the truncation boundary', () => {
  const context = createToolContext({ workspaceRoot: process.cwd() });
  const result = context.output.limitText('ok 😀', 5);

  assert.deepEqual(result, {
    originalBytes: 7,
    text: 'ok ',
    truncated: true,
  });
});
