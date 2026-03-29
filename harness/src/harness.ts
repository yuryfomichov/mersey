import { runLoop } from './loop.js';
import type { ModelProvider } from './models/index.js';
import { createProvider, type ProviderName } from './providers/index.js';

export type Message = {
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
};

export type Session = {
  id: string;
  createdAt: string;
  messages: Message[];
};

export type Harness = {
  session: Session;
  sendUserMessage(content: string): Promise<Message>;
};

export type CreateHarnessOptions = {
  providerInstance?: ModelProvider;
  provider?: ProviderName;
  sessionId?: string;
};

export function createHarness(options: CreateHarnessOptions = {}): Harness {
  const provider = options.providerInstance ?? createProvider(options.provider ?? 'minimax');

  const session: Session = {
    id: options.sessionId ?? 'local-session',
    createdAt: new Date().toISOString(),
    messages: [],
  };

  return {
    session,
    sendUserMessage(content: string): Promise<Message> {
      return runLoop(session, provider, content);
    },
  };
}
