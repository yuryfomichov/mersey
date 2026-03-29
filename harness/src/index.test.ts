import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createHarness } from './harness.js';
import { parseProviderName } from './providers/factory.js';
import { FakeProvider } from './providers/fake.js';
import { MemorySessionStore } from './sessions.js';
import type { Message, Session, SessionStore } from './sessions/index.js';
import { ReadFileTool } from './tools.js';

test('createHarness uses the injected provider and appends session history', async () => {
  const provider = new FakeProvider();
  const sessionStore = new MemorySessionStore();

  const harness = createHarness({ providerInstance: provider, sessionId: 'test-session', sessionStore });
  const reply = await harness.sendUserMessage('hello');

  assert.equal(reply.role, 'assistant');
  assert.equal(reply.content, 'reply:hello');
  assert.equal(harness.session.id, 'test-session');
  assert.equal(provider.requests.length, 1);
  assert.deepEqual(provider.requests[0]?.messages, [{ role: 'user', content: 'hello' }]);
  assert.equal(provider.requests[0]?.tools, undefined);
  assert.deepEqual(
    harness.session.messages.map((message) => ({ role: message.role, content: message.content })),
    [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'reply:hello' },
    ],
  );
  assert.deepEqual(
    (await sessionStore.listMessages('test-session')).map((message) => message.content),
    ['hello', 'reply:hello'],
  );
});

test('parseProviderName supports minimax and rejects unknown providers', () => {
  assert.equal(parseProviderName('fake'), 'fake');
  assert.equal(parseProviderName('minimax'), 'minimax');
  assert.equal(parseProviderName('openai'), 'openai');
  assert.throws(() => parseProviderName('openrouter'), /Unsupported provider/);
});

test('createHarness retries session initialization after a transient store failure', async () => {
  class FlakySessionStore implements SessionStore {
    private failed = false;

    async appendMessage(_sessionId: string, _message: Message): Promise<void> {}

    async createSession(session: Session): Promise<Session> {
      return {
        ...session,
        messages: [],
      };
    }

    async getSession(_sessionId: string): Promise<Session | null> {
      if (!this.failed) {
        this.failed = true;
        throw new Error('temporary failure');
      }

      return null;
    }

    async listMessages(_sessionId: string): Promise<Message[]> {
      return [];
    }
  }

  const harness = createHarness({
    providerInstance: new FakeProvider(),
    sessionStore: new FlakySessionStore(),
  });

  await assert.rejects(() => harness.sendUserMessage('hello'), /temporary failure/);

  const reply = await harness.sendUserMessage('hello again');

  assert.equal(reply.content, 'reply:hello again');
});

test('createHarness uses the canonical session returned by the store', async () => {
  class CanonicalSessionStore extends MemorySessionStore {
    override async getSession(_sessionId: string): Promise<Session | null> {
      return null;
    }

    override async createSession(session: Session): Promise<Session> {
      return {
        ...session,
        createdAt: '2026-03-29T00:00:00.000Z',
        messages: [
          {
            role: 'assistant',
            content: 'from-store',
            createdAt: '2026-03-29T00:00:01.000Z',
          },
        ],
      };
    }
  }

  const harness = createHarness({
    providerInstance: new FakeProvider(),
    sessionStore: new CanonicalSessionStore(),
  });

  await harness.sendUserMessage('hello');

  assert.equal(harness.session.createdAt, '2026-03-29T00:00:00.000Z');
  assert.equal(harness.session.messages[0]?.content, 'from-store');
});

test('createHarness executes read_file tool calls and continues the loop', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'mersey-'));

  try {
    await writeFile(join(rootDir, 'note.txt'), 'hello from file', 'utf8');

    let callCount = 0;
    const provider = new FakeProvider({
      reply: (input) => {
        callCount += 1;

        if (callCount === 1) {
          return {
            text: '',
            toolCalls: [
              {
                id: 'call-read-1',
                input: { path: 'note.txt' },
                name: 'read_file',
              },
            ],
          };
        }

        assert.equal(input.messages.at(-1)?.role, 'tool');
        assert.equal(input.messages.at(-1)?.content, 'hello from file');

        return {
          text: 'done:hello from file',
        };
      },
    });
    const harness = createHarness({
      providerInstance: provider,
      sessionId: 'tool-session',
      sessionStore: new MemorySessionStore(),
      tools: [new ReadFileTool({ workspaceRoot: rootDir })],
    });

    const reply = await harness.sendUserMessage('read the note');

    assert.equal(reply.role, 'assistant');
    assert.equal(reply.content, 'done:hello from file');
    assert.equal(provider.requests.length, 2);
    assert.deepEqual(
      provider.requests[0]?.tools?.map((tool) => tool.name),
      ['read_file'],
    );
    assert.deepEqual(
      harness.session.messages.map((message) => message.role),
      ['user', 'assistant', 'tool', 'assistant'],
    );

    const assistantToolMessage = harness.session.messages[1];

    assert.equal(assistantToolMessage?.role, 'assistant');
    assert.deepEqual(
      assistantToolMessage && 'toolCalls' in assistantToolMessage ? assistantToolMessage.toolCalls : undefined,
      [
        {
          id: 'call-read-1',
          input: { path: 'note.txt' },
          name: 'read_file',
        },
      ],
    );
    assert.equal(harness.session.messages[2]?.content, 'hello from file');
  } finally {
    await rm(rootDir, { force: true, recursive: true });
  }
});
