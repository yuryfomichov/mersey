import { createAsyncQueue } from './async-queue.js';
import { HarnessObserver } from './events/observer.js';
import { streamLoop, type TurnChunk } from './loop/loop.js';
import type { ModelProvider } from './models/provider.js';
import { Session } from './sessions/session.js';
import type { Message } from './sessions/types.js';
import type { ToolPolicy } from './tools/context.js';
import type { Tool } from './tools/types.js';
import { snapshot } from './utils/object.js';

type TurnStreamOptions = {
  content: string;
  observer: HarnessObserver;
  provider: ModelProvider;
  session: Session;
  stream?: boolean;
  systemPrompt?: string;
  toolPolicy: ToolPolicy;
  tools: Tool[];
};

export type TurnStreamFactoryOptions = Omit<TurnStreamOptions, 'content'>;

function createTurnStream({
  content,
  observer,
  provider,
  session,
  stream,
  systemPrompt,
  toolPolicy,
  tools,
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

        const iterator = streamLoop({
          content,
          history: session.messages,
          observer,
          provider,
          signal: abortController.signal,
          stream,
          systemPrompt,
          toolPolicy,
          tools,
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

export function createTurnStreamFactory(
  options: TurnStreamFactoryOptions,
): (content: string) => AsyncIterable<TurnChunk> & AsyncIterator<TurnChunk> {
  return (content: string) =>
    createTurnStream({
      ...options,
      content,
    });
}
