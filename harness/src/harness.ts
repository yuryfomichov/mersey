import type { ApprovalDecision, ApprovalResult, PendingApproval } from './approvals/types.js';
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
import { createToolRuntimeFactory } from './tools/runtime/index.js';
import type { ToolExecutionPolicy } from './tools/runtime/index.js';
import type { HarnessTool } from './tools/types.js';
import { createTurnStreamFactory } from './turn-stream.js';

export type ApprovalHandler = (pendingApproval: PendingApproval) => ApprovalDecision[] | Promise<ApprovalDecision[]>;

export class ApprovalRequiredError extends Error {
  pendingApproval: PendingApproval;

  constructor(pendingApproval: PendingApproval) {
    super('Turn requires approval before it can continue.');
    this.name = 'ApprovalRequiredError';
    this.pendingApproval = pendingApproval;
  }
}

export type Harness = {
  getPendingApproval(): PendingApproval | null;
  ready(): Promise<void>;
  resumePendingApprovalIfNeeded(): AsyncIterable<TurnChunk>;
  sendApproval(decisions: ApprovalDecision[]): Promise<ApprovalResult>;
  session: Session;
  streamApproval(decisions: ApprovalDecision[]): AsyncIterable<TurnChunk>;
  sendUserMessage(content: string): Promise<Message>;
  streamUserMessage(content: string): AsyncIterable<TurnChunk>;
  subscribe(listener: HarnessEventListener): () => void;
};

export type CreateHarnessOptions = {
  approvalHandler?: ApprovalHandler;
  debug?: boolean;
  loggers?: HarnessLogger[];
  providerInstance?: ModelProvider;
  provider?: ProviderDefinition;
  session?: Session;
  stream?: boolean;
  systemPrompt?: string;
  toolExecutionPolicy?: ToolExecutionPolicy;
  tools?: HarnessTool[];
};

function ensureProvider(options: Pick<CreateHarnessOptions, 'provider' | 'providerInstance'>): ModelProvider {
  const provider = options.providerInstance ?? (options.provider ? createProvider(options.provider) : null);

  if (!provider) {
    throw new Error('Missing provider. Pass providerInstance or provider config to createHarness().');
  }

  return provider;
}

async function* pendingApprovalStream(pendingApproval: PendingApproval): AsyncGenerator<TurnChunk> {
  yield {
    pendingApproval,
    type: 'approval_requested',
  };
}

async function* ensurePendingApprovalStream(
  session: Session,
  withApprovalHandling: (chunks: AsyncIterable<TurnChunk>) => AsyncIterable<TurnChunk>,
): AsyncGenerator<TurnChunk> {
  await session.ensure();

  if (!session.pendingApproval) {
    return;
  }

  yield* withApprovalHandling(pendingApprovalStream(session.pendingApproval));
}

type ApprovalResumeStream = (decisions: ApprovalDecision[]) => AsyncIterable<TurnChunk>;

function createApprovalHandlingWrapper(
  approvalHandler: ApprovalHandler | undefined,
  resumeApproval: ApprovalResumeStream,
): (chunks: AsyncIterable<TurnChunk>) => AsyncIterable<TurnChunk> {
  return (chunks: AsyncIterable<TurnChunk>): AsyncIterable<TurnChunk> => {
    if (!approvalHandler) {
      return chunks;
    }

    return (async function* iterate(stream: AsyncIterable<TurnChunk>): AsyncGenerator<TurnChunk> {
      for await (const chunk of stream) {
        if (chunk.type !== 'approval_requested') {
          yield chunk;
          continue;
        }

        const decisions = await approvalHandler(chunk.pendingApproval);

        yield* iterate(resumeApproval(decisions));
      }
    })(chunks);
  };
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
    stream: options.stream,
  });
  const turnStreams = createTurnStreamFactory({
    observer,
    provider: resolvedProvider,
    session,
    stream: options.stream,
    systemPrompt: options.systemPrompt,
    toolRuntimeFactory,
  });
  const withApprovalHandling = createApprovalHandlingWrapper(options.approvalHandler, turnStreams.streamApproval);

  return {
    getPendingApproval(): PendingApproval | null {
      return session.pendingApproval;
    },
    async ready(): Promise<void> {
      await session.ensure();
    },
    resumePendingApprovalIfNeeded(): AsyncIterable<TurnChunk> {
      return ensurePendingApprovalStream(session, withApprovalHandling);
    },
    async sendApproval(decisions: ApprovalDecision[]): Promise<ApprovalResult> {
      let finalMessage: Message | null = null;
      let nextPendingApproval: PendingApproval | null = null;

      for await (const chunk of withApprovalHandling(turnStreams.streamApproval(decisions))) {
        if (chunk.type === 'final_message') {
          finalMessage = chunk.message;
        }

        if (chunk.type === 'approval_requested') {
          nextPendingApproval = chunk.pendingApproval;
        }
      }

      if (finalMessage) {
        return finalMessage;
      }

      if (nextPendingApproval) {
        return nextPendingApproval;
      }

      throw new Error('Approval completed without a final assistant message or a pending approval.');
    },
    streamApproval(decisions: ApprovalDecision[]): AsyncIterable<TurnChunk> {
      return withApprovalHandling(turnStreams.streamApproval(decisions));
    },
    async sendUserMessage(content: string): Promise<Message> {
      let finalMessage: Message | null = null;

      for await (const chunk of withApprovalHandling(turnStreams.streamUserMessage(content))) {
        if (chunk.type === 'approval_requested') {
          throw new ApprovalRequiredError(chunk.pendingApproval);
        }

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
      return withApprovalHandling(turnStreams.streamUserMessage(content));
    },
    subscribe(listener: HarnessEventListener): () => void {
      return observer.subscribe(listener);
    },
    session,
  };
}
