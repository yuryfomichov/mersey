import { HarnessEventReporter } from '../events/reporter.js';
import type { ModelProvider } from '../models/provider.js';
import type { PluginRunner } from '../plugins/runner.js';
import type { HarnessSession } from '../sessions/runtime.js';
import type { Message } from '../sessions/types.js';
import type { ToolRuntimeFactory } from '../tools/runtime/index.js';
import { snapshot } from '../utils/object.js';
import { createAsyncQueue } from './async-queue.js';
import { streamLoop, type TurnChunk } from './loop.js';

/**
 * Options for creating a turn stream.
 */
type TurnStreamOptions = {
  content: string;
  reporter: HarnessEventReporter;
  pluginRunner: PluginRunner;
  provider: ModelProvider;
  signal?: AbortSignal;
  session: HarnessSession;
  stream: boolean;
  systemPrompt?: string;
  toolRuntimeFactory: ToolRuntimeFactory;
};

export type TurnStreamFactoryOptions = Omit<TurnStreamOptions, 'content' | 'stream' | 'pluginRunner'> & {
  pluginRunner: PluginRunner;
};

export type TurnStream = AsyncIterable<TurnChunk> & AsyncIterator<TurnChunk>;

export type TurnStreamFactory = (content: string, stream?: boolean, signal?: AbortSignal) => TurnStream;

function isAbortReason(error: unknown, signal: AbortSignal): boolean {
  return error === signal.reason || (error instanceof Error && error.name === 'AbortError');
}

/**
 * Executes a single turn (user message → model response → optional tool calls)
 * within a session. This is the core turn execution wrapper that handles:
 *
 * 1. **Session locking** — Only one turn can run per session at a time. The
 *    {@link Session.runExclusive} call ensures turns are serialized.
 *
 * 2. **Lazy start** — The turn does not begin until the first call to `next()`
 *    on the returned iterator. This allows the caller to attach abort signals
 *    or other setup before work begins.
 *
 * 3. **Async queue bridge** — The synchronous {@link streamLoop} generator
 *    yields {@link TurnChunk} values, which are pushed to an {@link AsyncQueue}
 *    for async consumption. This decouples the producer and consumer rates.
 *
 * 4. **Lifecycle** — On success, messages are committed to the session and
 *    the queue is ended. On error, the queue is failed and the error is rethrown.
 *
 * The returned iterator yields {@link TurnChunk} values:
 * - `{ delta, type: 'assistant_delta' }` — Streaming text from the model
 * - `{ type: 'assistant_message_completed' }` — All deltas streamed, tool calls incoming
 * - `{ message, type: 'final_message' }` — Turn complete, no tool calls
 *
 * @returns An async iterable/iterator that yields {@link TurnChunk} values.
 *          The underlying turn is aborted when `return()` is called.
 */
function createTurnStream({
  content,
  reporter,
  pluginRunner,
  provider,
  signal,
  session,
  stream,
  systemPrompt,
  toolRuntimeFactory,
}: TurnStreamOptions): AsyncIterable<TurnChunk> & AsyncIterator<TurnChunk> {
  const queue = createAsyncQueue<TurnChunk>();
  const abortController = new AbortController();
  const onAbort = () => {
    abortController.abort(signal?.reason);
  };
  let backgroundTask: Promise<void> | null = null;
  let started = false;

  const start = (): void => {
    if (started) {
      return;
    }

    started = true;

    if (signal?.aborted) {
      onAbort();
    } else {
      signal?.addEventListener('abort', onAbort, { once: true });
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
          history: historyBeforeTurn,
          reporter,
          pluginRunner,
          provider,
          signal: abortController.signal,
          stream,
          systemPrompt,
          toolRuntimeFactory,
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
          pluginRunner.runAfterTurnCommitted(afterTurnCommittedContext);
        }

        queue.end();
      } catch (error: unknown) {
        queue.fail(error);
        throw error;
      } finally {
        signal?.removeEventListener('abort', onAbort);
        unsubscribe();
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
