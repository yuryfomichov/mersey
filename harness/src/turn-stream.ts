import type { ApprovalDecision } from './approvals/types.js';
import { createAsyncQueue } from './async-queue.js';
import { HarnessObserver } from './events/observer.js';
import { streamApprovalLoop, streamLoop, type LoopResult, type TurnChunk } from './loop/loop.js';
import type { ModelProvider } from './models/provider.js';
import { Session } from './sessions/session.js';
import type { Message } from './sessions/types.js';
import type { ToolRuntimeFactory } from './tools/runtime/index.js';
import { snapshot } from './utils/object.js';

type TurnStreamOptions = {
  approvalDecisions?: ApprovalDecision[];
  content?: string;
  observer: HarnessObserver;
  provider: ModelProvider;
  resumePendingApproval?: boolean;
  session: Session;
  stream?: boolean;
  systemPrompt?: string;
  toolRuntimeFactory: ToolRuntimeFactory;
};

export type TurnStreamFactoryOptions = Omit<
  TurnStreamOptions,
  'approvalDecisions' | 'content' | 'resumePendingApproval'
>;

function createTurnStream({
  approvalDecisions,
  content,
  observer,
  provider,
  resumePendingApproval,
  session,
  stream,
  systemPrompt,
  toolRuntimeFactory,
}: TurnStreamOptions): AsyncIterable<TurnChunk> & AsyncIterator<TurnChunk> {
  const queue = createAsyncQueue<TurnChunk>();
  const abortController = new AbortController();
  let backgroundTask: Promise<void> | null = null;
  let started = false;

  const start = (): void => {
    if (started) {
      return;
    }

    started = true;

    backgroundTask = session.runExclusive(async () => {
      try {
        await session.ensure();
        observer.sessionStarted();

        if (resumePendingApproval) {
          const pendingApproval = session.pendingApproval;

          if (!pendingApproval) {
            throw new Error('No pending approval to resume.');
          }

          const iterator = streamApprovalLoop({
            approvalDecisions: approvalDecisions ?? [],
            history: session.messages,
            observer,
            pendingApproval,
            provider,
            signal: abortController.signal,
            stream,
            systemPrompt,
            toolRuntimeFactory,
          });
          let loopResult!: LoopResult;

          while (true) {
            const result = await iterator.next();

            if (result.done) {
              loopResult = result.value;
              break;
            }

            queue.push(snapshot(result.value));
          }

          await session.applyTurn(
            loopResult.turnMessages,
            loopResult.status === 'awaiting_approval' ? loopResult.pendingApproval : null,
          );

          queue.end();
          return;
        }

        if (session.turnStatus !== 'idle') {
          throw new Error('Cannot start a new turn while approval is pending.');
        }

        if (content === undefined) {
          throw new Error('Missing turn content.');
        }

        const iterator = streamLoop({
          content,
          history: session.messages,
          observer,
          provider,
          signal: abortController.signal,
          stream,
          systemPrompt,
          toolRuntimeFactory,
        });
        let loopResult!: LoopResult;

        while (true) {
          const result = await iterator.next();

          if (result.done) {
            loopResult = result.value;
            break;
          }

          queue.push(snapshot(result.value));
        }

        await session.applyTurn(
          loopResult.turnMessages,
          loopResult.status === 'awaiting_approval' ? loopResult.pendingApproval : null,
        );

        queue.end();
      } catch (error: unknown) {
        queue.fail(error);
        throw error;
      }
    });

    void backgroundTask.catch(() => {});
  };

  return {
    [Symbol.asyncIterator](): AsyncIterator<TurnChunk> {
      return this;
    },
    next(): Promise<IteratorResult<TurnChunk>> {
      start();
      return queue.iterable.next();
    },
    return(): Promise<IteratorResult<TurnChunk>> {
      if (!started) {
        return Promise.resolve({ done: true, value: undefined });
      }

      abortController.abort();

      return (async () => {
        await (queue.iterable.return?.() ?? Promise.resolve({ done: true, value: undefined }));
        await backgroundTask?.catch(() => {});

        return { done: true, value: undefined };
      })();
    },
  };
}

export function createTurnStreamFactory(options: TurnStreamFactoryOptions): {
  streamApproval: (approvalDecisions: ApprovalDecision[]) => AsyncIterable<TurnChunk> & AsyncIterator<TurnChunk>;
  streamUserMessage: (content: string) => AsyncIterable<TurnChunk> & AsyncIterator<TurnChunk>;
} {
  return {
    streamApproval: (approvalDecisions: ApprovalDecision[]) =>
      createTurnStream({
        ...options,
        approvalDecisions,
        resumePendingApproval: true,
      }),
    streamUserMessage: (content: string) =>
      createTurnStream({
        ...options,
        content,
      }),
  };
}
