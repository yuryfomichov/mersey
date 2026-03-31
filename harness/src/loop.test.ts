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
