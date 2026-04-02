import { HarnessObserver } from './events/observer.js';
import type { HarnessEventListener } from './events/types.js';
import { createFanoutLogger } from './logger/fanout.js';
import type { HarnessLogger } from './logger/types.js';
import type { TurnChunk } from './loop/loop.js';
import type { ModelProvider } from './models/provider.js';
import { createProvider, type ProviderDefinition } from './providers/factory.js';
import { MemorySessionStore } from './sessions/memory-store.js';
import { Session } from './sessions/session.js';
import type { Message } from './sessions/types.js';
import type { ToolPolicy } from './tools/context.js';
import type { Tool } from './tools/types.js';
import { createTurnStreamFactory } from './turn-stream.js';

export type Harness = {
  session: Session;
  sendUserMessage(content: string): Promise<Message>;
  streamUserMessage(content: string): AsyncIterable<TurnChunk>;
  subscribe(listener: HarnessEventListener): () => void;
};

export type CreateHarnessOptions = {
  debug?: boolean;
  loggers?: HarnessLogger[];
  providerInstance?: ModelProvider;
  provider?: ProviderDefinition;
  session?: Session;
  stream?: boolean;
  systemPrompt?: string;
  toolPolicy?: ToolPolicy;
  tools?: Tool[];
};

function ensureProvider(options: Pick<CreateHarnessOptions, 'provider' | 'providerInstance'>): ModelProvider {
  const provider = options.providerInstance ?? (options.provider ? createProvider(options.provider) : null);

  if (!provider) {
    throw new Error('Missing provider. Pass providerInstance or provider config to createHarness().');
  }

  return provider;
}

export function createHarness(options: CreateHarnessOptions = {}): Harness {
  const resolvedProvider = ensureProvider(options);
  const session = options.session ?? new Session({ id: 'local-session', store: new MemorySessionStore() });

  const observer = new HarnessObserver({
    debug: options.debug,
    logger: createFanoutLogger(options.loggers),
    providerName: resolvedProvider.name,
    sessionId: session.id,
    stream: options.stream,
  });
  const streamTurn = createTurnStreamFactory({
    observer,
    provider: resolvedProvider,
    session,
    stream: options.stream,
    systemPrompt: options.systemPrompt,
    toolPolicy: options.toolPolicy ?? { workspaceRoot: process.cwd() },
    tools: options.tools ?? [],
  });

  observer.sessionStarted();

  return {
    session,
    async sendUserMessage(content: string): Promise<Message> {
      let finalMessage: Message | null = null;

      for await (const chunk of streamTurn(content)) {
        if (chunk.type === 'final_message') {
          finalMessage = chunk.message;
        }
      }

      if (!finalMessage) {
        throw new Error('Turn completed without a final assistant message.');
      }

      return finalMessage;
    },
    streamUserMessage(content: string): AsyncIterable<TurnChunk> {
      return streamTurn(content);
    },
    subscribe(listener: HarnessEventListener): () => void {
      return observer.subscribe(listener);
    },
  };
}
