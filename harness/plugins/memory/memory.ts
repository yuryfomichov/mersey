import type { TurnContextContribution } from '../../runtime/context/types.js';
import type { TurnCommitObserver, TurnContextCollector } from '../../runtime/plugins/types.js';
import { type MemoryItem, type MemoryPluginOptions } from './types.js';

const DEFAULT_MAX_CONTEXT_CHARS = 5_000;
const DEFAULT_TOP_K = 5;

export type MemoryIntegration = {
  collector: TurnContextCollector;
  commitObserver: TurnCommitObserver;
};

export function createMemoryPlugin(options: MemoryPluginOptions): MemoryIntegration {
  const sourceId = options.name ?? 'memory';
  const maxContextChars = options.maxContextChars ?? DEFAULT_MAX_CONTEXT_CHARS;
  const swallowRecallErrors = options.swallowRecallErrors ?? true;
  const topK = options.topK ?? DEFAULT_TOP_K;

  assertNonNegativeInteger(topK, 'topK');
  assertPositiveInteger(maxContextChars, 'maxContextChars');

  return {
    collector: {
      async collect(ctx): Promise<TurnContextContribution[]> {
        if (ctx.iteration > 1) {
          return [];
        }

        const query = (options.buildQuery?.(ctx) ?? ctx.userMessage.content).trim();

        if (query.length === 0 || topK === 0) {
          return [];
        }

        ctx.signal?.throwIfAborted();
        const memories = await recallMemories({
          query,
          recall: options.recall,
          recallContext: ctx,
          signal: ctx.signal,
          swallowRecallErrors,
          topK,
        });

        if (memories.length === 0) {
          return [];
        }

        ctx.signal?.throwIfAborted();

        return (
          (await options.formatMemories?.(memories, ctx)) ??
          defaultFormatMemories(memories, { maxContextChars, sourceId })
        );
      },
    },
    commitObserver: {
      async afterTurnCommitted(ctx): Promise<void> {
        await options.remember(ctx);
      },
    },
  };
}

async function recallMemories(options: {
  query: string;
  recall: MemoryPluginOptions['recall'];
  recallContext: Parameters<NonNullable<MemoryPluginOptions['buildQuery']>>[0];
  signal?: AbortSignal;
  swallowRecallErrors: boolean;
  topK: number;
}): Promise<MemoryItem[]> {
  try {
    return (await options.recall(options.query, options.recallContext)).slice(0, options.topK);
  } catch (error: unknown) {
    if (isAbortError(error, options.signal) || !options.swallowRecallErrors) {
      throw error;
    }

    return [];
  }
}

function assertNonNegativeInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer.`);
  }
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
}

function defaultFormatMemories(
  memories: MemoryItem[],
  options: {
    maxContextChars: number;
    sourceId: string;
  },
): TurnContextContribution[] {
  const intro =
    'Relevant memory for the next answer. Use only memory that helps with this request. If memory conflicts with the conversation, prefer the conversation.';
  const budget = Math.max(options.maxContextChars - intro.length - 2, 0);
  const rendered = renderMemories(memories, budget);

  if (!rendered) {
    return [];
  }

  return [
    {
      kind: 'message',
      message: {
        content: `${intro}\n\n${rendered}`,
        role: 'user',
      },
      sourceId: options.sourceId,
    },
  ];
}

function renderMemories(memories: MemoryItem[], budget: number): string {
  if (budget <= 0) {
    return '';
  }

  let remaining = budget;
  const sections: string[] = [];

  for (const [index, memory] of memories.entries()) {
    const body = memory.content.trim();

    if (!body) {
      continue;
    }

    const label = getMemoryLabel(memory, index);
    const header = `[Memory ${index + 1}: ${label}]`;
    const section = `${header}\n${body}`;

    if (section.length <= remaining) {
      sections.push(section);
      remaining -= section.length + 2;
      continue;
    }

    const minBodyLength = 24;
    const allowedBodyLength = remaining - header.length - 1;

    if (allowedBodyLength < minBodyLength) {
      break;
    }

    const ellipsis = '...';
    const truncatedBodyLength = Math.max(allowedBodyLength - ellipsis.length, 0);

    sections.push(`${header}\n${body.slice(0, truncatedBodyLength).trimEnd()}${ellipsis}`);
    break;
  }

  return sections.join('\n\n');
}

function getMemoryLabel(memory: MemoryItem, index: number): string {
  return memory.source ?? memory.title ?? memory.id ?? `memory-${index + 1}`;
}

function isAbortError(error: unknown, signal?: AbortSignal): boolean {
  return (
    signal?.aborted === true && (error === signal.reason || (error instanceof Error && error.name === 'AbortError'))
  );
}
