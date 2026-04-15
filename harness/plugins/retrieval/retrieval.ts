import type { ModelMessage } from '../../runtime/models/types.js';
import type { HarnessPlugin, PrepareProviderRequestResult } from '../../runtime/plugins/types.js';
import type { RetrievedChunk, RetrievalPluginOptions } from './types.js';

const DEFAULT_MAX_CONTEXT_CHARS = 5_000;
const DEFAULT_TOP_K = 5;

export function createRetrievalPlugin(options: RetrievalPluginOptions): HarnessPlugin {
  const pluginName = options.name ?? 'retrieval';
  const maxContextChars = options.maxContextChars ?? DEFAULT_MAX_CONTEXT_CHARS;
  const topK = options.topK ?? DEFAULT_TOP_K;

  assertNonNegativeInteger(topK, 'topK');
  assertPositiveInteger(maxContextChars, 'maxContextChars');

  return {
    name: pluginName,
    async prepareProviderRequest(_request, ctx): Promise<PrepareProviderRequestResult> {
      const query = (options.buildQuery?.(ctx) ?? ctx.userMessage.content).trim();

      if (query.length === 0 || topK === 0) {
        return {};
      }

      const chunks = (await options.retrieve(query, ctx)).slice(0, topK);

      if (chunks.length === 0) {
        return {};
      }

      const prepared = (await options.formatChunks?.(chunks, ctx)) ?? defaultFormatChunks(chunks, { maxContextChars });

      return {
        ...prepared,
      };
    },
  };
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

function defaultFormatChunks(
  chunks: RetrievedChunk[],
  options: {
    maxContextChars: number;
  },
): PrepareProviderRequestResult {
  const intro =
    'Retrieved context for the next answer. Use only relevant facts. If the context is insufficient, say so.';
  const budget = Math.max(options.maxContextChars - intro.length - 2, 0);
  const rendered = renderChunks(chunks, budget);

  if (!rendered) {
    return {};
  }

  const message: ModelMessage = {
    content: `${intro}\n\n${rendered}`,
    role: 'user',
  };

  return {
    prependMessages: [message],
  };
}

function renderChunks(chunks: RetrievedChunk[], budget: number): string {
  if (budget <= 0) {
    return '';
  }

  let remaining = budget;
  const sections: string[] = [];

  for (const [index, chunk] of chunks.entries()) {
    const body = chunk.content.trim();

    if (!body) {
      continue;
    }

    const label = getChunkLabel(chunk, index);
    const header = `[Source ${index + 1}: ${label}]`;
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

    sections.push(`${header}\n${body.slice(0, Math.max(allowedBodyLength - 1, 0)).trimEnd()}…`);
    break;
  }

  return sections.join('\n\n');
}

function getChunkLabel(chunk: RetrievedChunk, index: number): string {
  return chunk.source ?? chunk.title ?? chunk.id ?? `chunk-${index + 1}`;
}
