import { asFinalMessage, createTurnStreamFactory, type TurnStream } from './core/turn-stream.js';
import { HarnessEventEmitter } from './events/emitter.js';
import { HarnessEventReporter } from './events/reporter.js';
import type { HarnessEventListener } from './events/types.js';
import type { ModelProvider } from './models/provider.js';
import { createPluginRunner } from './plugins/runner.js';
import type { HarnessPlugin } from './plugins/types.js';
import type { HarnessSession } from './sessions/runtime.js';
import type { Message } from './sessions/types.js';
import { createToolRuntimeFactory } from './tools/runtime/index.js';
import type { Tool } from './tools/types.js';

export type HarnessSessionView = {
  readonly createdAt: string;
  readonly id: string;
  readonly messages: readonly Message[];

  ensure(): Promise<void>;
  getContextSize(): Promise<number>;
  getUsage(): Promise<import('./models/types.js').ModelUsage>;
};

export type Harness = {
  session: HarnessSessionView;
  sendMessage(content: string, options?: { signal?: AbortSignal }): Promise<Message>;
  streamMessage(content: string, options?: { signal?: AbortSignal }): TurnStream;
  subscribe(listener: HarnessEventListener): () => void;
};

export type CreateHarnessOptions = {
  debug?: boolean;
  plugins?: HarnessPlugin[];
  providerInstance: ModelProvider;
  session: HarnessSession;
  systemPrompt?: string;
  tools?: Tool[];
};

function ensureProvider(options: CreateHarnessOptions | undefined): ModelProvider {
  const provider = options?.providerInstance ?? null;

  if (!provider) {
    throw new Error('Missing provider. Pass providerInstance to createHarness().');
  }

  return provider;
}

function ensureSession(options: CreateHarnessOptions | undefined): HarnessSession {
  const session = options?.session ?? null;

  if (!session) {
    throw new Error('Missing session. Pass session to createHarness().');
  }

  return session;
}

export function createHarness(options: CreateHarnessOptions): Harness {
  const resolvedProvider = ensureProvider(options);
  const session = ensureSession(options);
  const toolRuntimeFactory = createToolRuntimeFactory({ tools: options.tools ?? [] });
  const eventEmitter = new HarnessEventEmitter();

  const reporter = new HarnessEventReporter({
    debug: options.debug,
    eventEmitter,
    getSessionId: () => session.id,
    providerName: resolvedProvider.name,
  });
  const pluginRunner = createPluginRunner({
    reporter,
    plugins: options.plugins ?? [],
    runId: reporter.getRunId(),
  });
  const streamTurn = createTurnStreamFactory({
    reporter,
    pluginRunner,
    provider: resolvedProvider,
    session,
    systemPrompt: options.systemPrompt,
    toolRuntimeFactory,
  });
  const sessionView: HarnessSessionView = {
    get createdAt() {
      return session.createdAt;
    },
    get id() {
      return session.id;
    },
    get messages() {
      return session.messages;
    },
    ensure() {
      return session.ensure();
    },
    getContextSize() {
      return session.getContextSize();
    },
    getUsage() {
      return session.getUsage();
    },
  };

  return {
    session: sessionView,
    sendMessage(content: string, options?: { signal?: AbortSignal }): Promise<Message> {
      return asFinalMessage(streamTurn)(content, options?.signal);
    },
    streamMessage(content: string, options?: { signal?: AbortSignal }): TurnStream {
      return streamTurn(content, true, options?.signal);
    },
    subscribe(listener: HarnessEventListener): () => void {
      return reporter.subscribe(listener);
    },
  };
}
