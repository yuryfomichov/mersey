import type { TurnCommitObserverRunner } from '../commit/runner.js';
import type { TurnContextCollectorRunner } from '../context/runner.js';
import { HarnessEventReporter } from '../events/reporter.js';
import { RuntimeWorkTracker } from '../lifecycle.js';
import type { ModelProvider } from '../models/provider.js';
import type { PluginRunner } from '../plugins/runner.js';
import type { HarnessSession } from '../sessions/runtime.js';
import type { Message } from '../sessions/types.js';
import type { ComposedToolCatalog } from '../tools/composed-catalog.js';
import { snapshot } from '../utils/object.js';
import { createAsyncQueue } from './async-queue.js';
import { streamLoop, type TurnChunk } from './loop.js';

type TurnStreamOptions = {
  commitObservers: TurnCommitObserverRunner;
  content: string;
  contextCollectors: TurnContextCollectorRunner;
  pluginRunner: PluginRunner;
  provider: ModelProvider;
  reporter: HarnessEventReporter;
  runtimeSignal?: AbortSignal;
  session: HarnessSession;
  signal?: AbortSignal;
  stream: boolean;
  systemPrompt?: string;
  toolCatalog: ComposedToolCatalog;
  workTracker: RuntimeWorkTracker;
};

export type TurnStreamFactoryOptions = Omit<TurnStreamOptions, 'content' | 'stream' | 'signal'>;

export type TurnStream = AsyncIterable<TurnChunk> & AsyncIterator<TurnChunk>;

export type TurnStreamFactory = (content: string, stream?: boolean, signal?: AbortSignal) => TurnStream;

function isAbortReason(error: unknown, signal: AbortSignal): boolean {
  return error === signal.reason || (error instanceof Error && error.name === 'AbortError');
}

function createTurnStream({
  commitObservers,
  content,
  contextCollectors,
  reporter,
  pluginRunner,
  provider,
  runtimeSignal,
  signal,
  session,
  stream,
  systemPrompt,
  toolCatalog,
  workTracker,
}: TurnStreamOptions): AsyncIterable<TurnChunk> & AsyncIterator<TurnChunk> {
  const queue = createAsyncQueue<TurnChunk>();
  const abortController = new AbortController();
  const onAbort = () => {
    abortController.abort(signal?.reason ?? runtimeSignal?.reason);
  };
  let backgroundTask: Promise<void> | null = null;
  let started = false;

  const start = (): void => {
    if (started) {
      return;
    }

    started = true;

    if (signal?.aborted || runtimeSignal?.aborted) {
      onAbort();
    } else {
      signal?.addEventListener('abort', onAbort, { once: true });
      runtimeSignal?.addEventListener('abort', onAbort, { once: true });
    }

    backgroundTask = session.runExclusive(async () => {
      let turnId: string | null = null;
      const unsubscribe = reporter.subscribe((event) => {
        if (event.type === 'turn_started') {
          turnId = event.turnId;
        }
      });

      try {
        await session.ensure();
        const historyBeforeTurn = snapshot(session.messages);
        reporter.sessionStarted();

        const iterator = streamLoop({
          content,
          contextCollectors,
          history: historyBeforeTurn,
          pluginRunner,
          provider,
          reporter,
          signal: abortController.signal,
          stream,
          systemPrompt,
          toolCatalog,
        });
        let turnMessages: Message[] = [];
        let finalMessageChunk: TurnChunk | null = null;

        while (true) {
          const result = await iterator.next();

          if (result.done) {
            turnMessages = result.value;
            break;
          }

          if (result.value.type === 'final_message') {
            finalMessageChunk = snapshot(result.value);
            continue;
          }

          queue.push(snapshot(result.value));
        }

        const afterTurnCommittedContext = turnId
          ? {
              historyBeforeTurn,
              model: provider.model,
              provider,
              providerName: provider.name,
              sessionId: session.id,
              turnId,
              turnMessages: snapshot(turnMessages),
            }
          : null;

        await session.commit(turnMessages);

        if (finalMessageChunk) {
          queue.push(finalMessageChunk);
        }

        if (afterTurnCommittedContext) {
          commitObservers.runAfterCommit(afterTurnCommittedContext);
        }

        queue.end();
      } catch (error: unknown) {
        queue.fail(error);
        throw error;
      } finally {
        signal?.removeEventListener('abort', onAbort);
        runtimeSignal?.removeEventListener('abort', onAbort);
        unsubscribe();
      }
    });

    void workTracker.track(backgroundTask.catch(() => {}));
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

        if (backgroundTask) {
          try {
            await backgroundTask;
          } catch (error: unknown) {
            if (!isAbortReason(error, abortController.signal)) {
              throw error;
            }
          }
        }

        return { done: true, value: undefined };
      })();
    },
  };
}

export function createTurnStreamFactory(options: TurnStreamFactoryOptions): TurnStreamFactory {
  return (content: string, stream = true, signal?: AbortSignal) =>
    createTurnStream({
      ...options,
      content,
      signal,
      stream,
    });
}

export function asFinalMessage(
  factory: TurnStreamFactory,
): (content: string, signal?: AbortSignal) => Promise<Message> {
  return async (content: string, signal?: AbortSignal): Promise<Message> => {
    let finalMessage: Message | null = null;

    for await (const chunk of factory(content, false, signal)) {
      if (chunk.type === 'final_message') {
        finalMessage = chunk.message;
      }
    }

    if (!finalMessage) {
      throw new Error('Turn completed without a final assistant message.');
    }

    return finalMessage;
  };
}
