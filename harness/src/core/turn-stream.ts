import { HarnessObserver } from '../events/observer.js';
import type { ModelProvider } from '../models/provider.js';
import { Session } from '../sessions/session.js';
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
  observer: HarnessObserver;
  provider: ModelProvider;
  session: Session;
  stream: boolean;
  systemPrompt?: string;
  toolRuntimeFactory: ToolRuntimeFactory;
};

export type TurnStreamFactoryOptions = Omit<TurnStreamOptions, 'content' | 'stream'>;

export type TurnStream = AsyncIterable<TurnChunk> & AsyncIterator<TurnChunk>;

export type TurnStreamFactory = (content: string, stream?: boolean) => TurnStream;

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
  observer,
  provider,
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
        let turnMessages: Message[] = [];

        while (true) {
          const result = await iterator.next();

          if (result.done) {
            turnMessages = result.value;
            break;
          }

          queue.push(snapshot(result.value));
        }

        await session.commit(turnMessages);
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

export function createTurnStreamFactory(options: TurnStreamFactoryOptions): TurnStreamFactory {
  return (content: string, stream = true) =>
    createTurnStream({
      ...options,
      content,
      stream,
    });
}

export function asFinalMessage(factory: TurnStreamFactory): (content: string) => Promise<Message> {
  return async (content: string): Promise<Message> => {
    let finalMessage: Message | null = null;

    for await (const chunk of factory(content, false)) {
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
