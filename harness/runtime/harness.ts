import { TurnCommitObserverRunner } from './commit/runner.js';
import { TurnContextCollectorRunner } from './context/runner.js';
import { asFinalMessage, createTurnStreamFactory, type TurnStream } from './core/turn-stream.js';
import { HarnessEventEmitter } from './events/emitter.js';
import { HarnessEventReporter } from './events/reporter.js';
import type { HarnessEventListener } from './events/types.js';
import { RuntimeWorkTracker } from './lifecycle.js';
import type { ModelProvider } from './models/provider.js';
import { createPluginRunner } from './plugins/runner.js';
import type { HarnessPlugin, TurnCommitObserver, TurnContextCollector } from './plugins/types.js';
import type { HarnessRuntime, HarnessRuntimeStartup, CreateHarnessRuntimeResult } from './runtime.js';
import type { HarnessSession } from './sessions/runtime.js';
import type { Message } from './sessions/types.js';
import { type RuntimeSourceRegistration } from './sources.js';
import { ComposedToolCatalog } from './tools/composed-catalog.js';
import { createEmptyToolCatalog, createStaticToolCatalog, type ToolCatalog } from './tools/runtime/index.js';
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
  commitObservers?: TurnCommitObserverRunner;
  contextCollectors?: TurnContextCollectorRunner;
  debug?: boolean;
  plugins?: HarnessPlugin[];
  providerInstance: ModelProvider;
  runtimeSignal?: AbortSignal;
  session: HarnessSession;
  systemPrompt?: string;
  toolCatalog?: ComposedToolCatalog;
  tools?: Tool[];
  workTracker?: RuntimeWorkTracker;
};

export type CreateHarnessRuntimeOptions = {
  collectors?: RuntimeSourceRegistration<TurnContextCollector>[];
  commitObservers?: RuntimeSourceRegistration<TurnCommitObserver>[];
  debug?: boolean;
  plugins?: HarnessPlugin[];
  providerInstance: ModelProvider;
  session: HarnessSession;
  systemPrompt?: string;
  toolCatalogs?: RuntimeSourceRegistration<ToolCatalog>[];
  tools?: Tool[];
};

function ensureProvider(options: CreateHarnessOptions | CreateHarnessRuntimeOptions | undefined): ModelProvider {
  const provider = options?.providerInstance ?? null;

  if (!provider) {
    throw new Error('Missing provider. Pass providerInstance to createHarnessRuntime().');
  }

  return provider;
}

function ensureSession(options: CreateHarnessOptions | CreateHarnessRuntimeOptions | undefined): HarnessSession {
  const session = options?.session ?? null;

  if (!session) {
    throw new Error('Missing session. Pass session to createHarnessRuntime().');
  }

  return session;
}

function toRuntimeStartup(
  sources: HarnessRuntimeStartup['sources'],
  diagnostics: HarnessRuntimeStartup['diagnostics'],
): HarnessRuntimeStartup {
  const requiredSourceIds = new Set(sources.filter((source) => source.required).map((source) => source.sourceId));
  const hasFailingRequiredSource = sources.some((source) => source.required && source.status === 'failed');
  const hasRequiredErrorDiagnostic = diagnostics.some(
    (diagnostic) =>
      diagnostic.severity === 'error' && (!diagnostic.sourceId || requiredSourceIds.has(diagnostic.sourceId)),
  );
  const status =
    hasFailingRequiredSource || hasRequiredErrorDiagnostic
      ? 'failed'
      : sources.some((source) => source.status === 'degraded') ||
          sources.some((source) => source.status === 'failed') ||
          diagnostics.some((diagnostic) => diagnostic.severity === 'error') ||
          diagnostics.some((diagnostic) => diagnostic.severity === 'warning')
        ? 'degraded'
        : 'ready';

  return {
    diagnostics,
    sources,
    status,
  };
}

function toToolCatalogRegistrations(options: CreateHarnessRuntimeOptions): RuntimeSourceRegistration<ToolCatalog>[] {
  const explicitCatalogs = options.toolCatalogs ?? [];

  if (explicitCatalogs.length > 0) {
    return explicitCatalogs;
  }

  if ((options.tools ?? []).length > 0) {
    return [
      {
        required: false,
        sourceId: 'local-tools',
        value: createStaticToolCatalog({ sourceId: 'local-tools', tools: options.tools ?? [] }),
      },
    ];
  }

  return [
    {
      required: false,
      sourceId: 'empty-tools',
      value: createEmptyToolCatalog(),
    },
  ];
}

export function createHarness(options: CreateHarnessOptions): Harness {
  const resolvedProvider = ensureProvider(options);
  const session = ensureSession(options);
  const workTracker = options.workTracker ?? new RuntimeWorkTracker();
  const toolCatalog =
    options.toolCatalog ??
    new ComposedToolCatalog([
      {
        required: false,
        sourceId: (options.tools ?? []).length > 0 ? 'local-tools' : 'empty-tools',
        value:
          (options.tools ?? []).length > 0
            ? createStaticToolCatalog({ tools: options.tools ?? [] })
            : createEmptyToolCatalog(),
      },
    ]);
  const contextCollectors = options.contextCollectors ?? new TurnContextCollectorRunner([]);
  const eventEmitter = new HarnessEventEmitter();

  const reporter = new HarnessEventReporter({
    debug: options.debug,
    eventEmitter,
    getSessionId: () => session.id,
    providerName: resolvedProvider.name,
  });
  const pluginRunner = createPluginRunner({
    plugins: options.plugins ?? [],
    reporter,
    runId: reporter.getRunId(),
    workTracker,
  });
  const commitObservers =
    options.commitObservers ?? new TurnCommitObserverRunner({ registrations: [], reporter, workTracker });
  const streamTurn = createTurnStreamFactory({
    commitObservers,
    contextCollectors,
    pluginRunner,
    provider: resolvedProvider,
    reporter,
    runtimeSignal: options.runtimeSignal,
    session,
    systemPrompt: options.systemPrompt,
    toolCatalog,
    workTracker,
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

export async function createHarnessRuntime(options: CreateHarnessRuntimeOptions): Promise<CreateHarnessRuntimeResult> {
  const provider = ensureProvider(options);
  const session = ensureSession(options);
  const workTracker = new RuntimeWorkTracker();
  const runtimeAbortController = new AbortController();
  const toolCatalog = new ComposedToolCatalog(toToolCatalogRegistrations(options));
  const contextCollectors = new TurnContextCollectorRunner(options.collectors ?? []);
  const eventEmitter = new HarnessEventEmitter();
  const reporter = new HarnessEventReporter({
    debug: options.debug,
    eventEmitter,
    getSessionId: () => session.id,
    providerName: provider.name,
  });
  const commitObservers = new TurnCommitObserverRunner({
    registrations: options.commitObservers ?? [],
    reporter,
    workTracker,
  });

  workTracker.addDisposable({
    async dispose() {
      await commitObservers.dispose();
    },
  });
  workTracker.addDisposable({
    async dispose() {
      await contextCollectors.dispose();
    },
  });
  workTracker.addDisposable({
    async dispose() {
      await toolCatalog.dispose();
    },
  });

  const [toolCatalogStartup, contextStartup, observerStartup] = await Promise.all([
    toolCatalog.runStartupValidation(),
    contextCollectors.runStartupValidation(),
    commitObservers.runStartupValidation(),
  ]);
  const startup = toRuntimeStartup(
    [...toolCatalogStartup.sources, ...contextStartup.sources, ...observerStartup.sources],
    [...toolCatalogStartup.diagnostics, ...contextStartup.diagnostics, ...observerStartup.diagnostics],
  );

  if (startup.status === 'failed') {
    runtimeAbortController.abort();
    await workTracker.dispose();
    return {
      ok: false,
      startup,
    };
  }

  const harness = createHarness({
    commitObservers,
    contextCollectors,
    debug: options.debug,
    plugins: options.plugins,
    providerInstance: provider,
    runtimeSignal: runtimeAbortController.signal,
    session,
    systemPrompt: options.systemPrompt,
    toolCatalog,
    workTracker,
  });

  const runtime: HarnessRuntime = {
    dispose: async () => {
      runtimeAbortController.abort();
      await workTracker.dispose();
    },
    harness,
    startup,
    subscribe(listener: HarnessEventListener): () => void {
      return harness.subscribe(listener);
    },
  };

  return {
    ok: true,
    runtime,
  };
}
