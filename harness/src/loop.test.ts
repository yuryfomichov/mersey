import assert from 'node:assert/strict';
import test from 'node:test';

import { runLoop } from './loop.js';
import { FakeProvider } from './providers/fake.js';
import { MemorySessionStore } from './sessions.js';
import type { Session } from './sessions/index.js';

test('runLoop does not persist assistant tool calls when the tool iteration cap is exceeded', async () => {
  const sessionStore = new MemorySessionStore();
  const session: Session = {
    createdAt: new Date().toISOString(),
    id: 'tool-overflow-session',
    messages: [],
  };

  await sessionStore.createSession(session);

  await assert.rejects(
    () =>
      runLoop({
        content: 'trigger tool loop',
        options: { maxToolIterations: 0 },
        provider: new FakeProvider({
          reply: {
            text: '',
            toolCalls: [
              {
                id: 'call-1',
                input: {},
                name: 'missing_tool',
              },
            ],
          },
        }),
        session,
        sessionStore,
        toolPolicy: { workspaceRoot: process.cwd() },
        tools: [],
      }),
    /Tool loop exceeded 0 iterations/,
  );

  assert.deepEqual(session.messages.map((message) => message.role), ['user']);
  assert.deepEqual((await sessionStore.listMessages(session.id)).map((message) => message.role), ['user']);
});

test('runLoop swallows event sink failures', async () => {
  const sessionStore = new MemorySessionStore();
  const session: Session = {
    createdAt: new Date().toISOString(),
    id: 'event-sink-session',
    messages: [],
  };

  await sessionStore.createSession(session);

  const reply = await runLoop({
    content: 'hello',
    emitEvent(): void {
      throw new Error('sink failed');
    },
    provider: new FakeProvider(),
    session,
    sessionStore,
    toolPolicy: { workspaceRoot: process.cwd() },
    tools: [],
  });

  assert.equal(reply.content, 'reply:hello');
  assert.deepEqual(session.messages.map((message) => message.role), ['user', 'assistant']);
});

test('runLoop owns fallback text when provider returns an empty non-tool reply', async () => {
  const sessionStore = new MemorySessionStore();
  const session: Session = {
    createdAt: new Date().toISOString(),
    id: 'fallback-session',
    messages: [],
  };

  await sessionStore.createSession(session);

  const reply = await runLoop({
    content: 'hello',
    provider: new FakeProvider({
      reply: {
        text: '',
      },
    }),
    session,
    sessionStore,
    toolPolicy: { workspaceRoot: process.cwd() },
    tools: [],
  });

  assert.equal(reply.content, 'I could not produce a response for that request.');
});
