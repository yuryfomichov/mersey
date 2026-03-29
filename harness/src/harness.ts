import { runLoop } from './loop.js';
import type { ModelProvider } from './models/index.js';
import { createProvider, type ProviderDefinition } from './providers/index.js';
import { MemorySessionStore, type Message, type Session, type SessionStore } from './sessions/index.js';

export type Harness = {
  session: Session;
  sendUserMessage(content: string): Promise<Message>;
};

export type CreateHarnessOptions = {
  providerInstance?: ModelProvider;
  provider?: ProviderDefinition;
  sessionStore?: SessionStore;
  sessionId?: string;
};

export function createHarness(options: CreateHarnessOptions = {}): Harness {
  const provider = options.providerInstance ?? (options.provider ? createProvider(options.provider) : null);
  const sessionStore = options.sessionStore ?? new MemorySessionStore();

  if (!provider) {
    throw new Error('Missing provider. Pass providerInstance or provider config to createHarness().');
  }

  const session: Session = {
    id: options.sessionId ?? 'local-session',
    createdAt: new Date().toISOString(),
    messages: [],
  };

  let initializedSessionPromise: Promise<void> | null = null;

  async function ensureSession(): Promise<void> {
    if (initializedSessionPromise) {
      return initializedSessionPromise;
    }

    initializedSessionPromise = (async () => {
      const existingSession = await sessionStore.getSession(session.id);

      if (existingSession) {
        session.createdAt = existingSession.createdAt;
        session.messages = existingSession.messages;
        return;
      }

      await sessionStore.createSession(session);
    })();

    return initializedSessionPromise;
  }

  return {
    session,
    async sendUserMessage(content: string): Promise<Message> {
      await ensureSession();
      return runLoop(session, sessionStore, provider, content);
    },
  };
}
