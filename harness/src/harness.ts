import type { TurnChunk } from './core/loop.js';
import { asFinalMessage, createTurnStreamFactory } from './core/turn-stream.js';
import { HarnessObserver } from './events/observer.js';
import type { HarnessEventListener } from './events/types.js';
import { createFanoutLogger } from './logger/fanout.js';
import type { HarnessLogger } from './logger/types.js';
import type { ModelProvider } from './models/provider.js';
import type { HarnessPlugin } from './plugins/types.js';
import { createProvider, type ProviderDefinition } from './providers/factory.js';
import { MemorySessionStore } from './sessions/memory-store.js';
import { Session } from './sessions/session.js';
import type { Message } from './sessions/types.js';
import { createToolRuntimeFactory } from './tools/runtime/index.js';
import type { ToolExecutionPolicy } from './tools/runtime/index.js';
import type { Tool } from './tools/types.js';

export type Harness = {
  session: Session;
  sendMessage(content: string): Promise<Message>;
  streamMessage(content: string): AsyncIterable<TurnChunk>;
  subscribe(listener: HarnessEventListener): () => void;
};

export type CreateHarnessOptions = {
  debug?: boolean;
  loggers?: HarnessLogger[];
  plugins?: HarnessPlugin[];
  providerInstance?: ModelProvider;
  provider?: ProviderDefinition;
  session?: Session;
  systemPrompt?: string;
  toolExecutionPolicy?: ToolExecutionPolicy;
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
  const toolRuntimeFactory = createToolRuntimeFactory({
    policy: options.toolExecutionPolicy ?? { workspaceRoot: process.cwd() },
    tools: options.tools ?? [],
  });

  const observer = new HarnessObserver({
    debug: options.debug,
    getSessionId: () => session.id,
    logger: createFanoutLogger(options.loggers),
    providerName: resolvedProvider.name,
  });
  const streamTurn = createTurnStreamFactory({
    observer,
    plugins: options.plugins ?? [],
    provider: resolvedProvider,
    session,
    systemPrompt: options.systemPrompt,
    toolRuntimeFactory,
  });

  return {
    session,
    sendMessage: asFinalMessage(streamTurn),
    streamMessage(content: string): AsyncIterable<TurnChunk> {
      return streamTurn(content);
    },
    subscribe(listener: HarnessEventListener): () => void {
      return observer.subscribe(listener);
    },
  };
}
