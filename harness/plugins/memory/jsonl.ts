import { createReadStream } from 'node:fs';
import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createInterface } from 'node:readline';

import type { HarnessPlugin } from '../../runtime/plugins/types.js';
import { createMemoryPlugin } from './memory.js';
import type { MemoryItem, MemoryRememberContext } from './types.js';

export type JsonlMemoryPluginOptions = {
  maxContextChars?: number;
  name?: string;
  path: string;
  topK?: number;
};

type StoredMemoryRecord = {
  content: string;
  createdAt: string;
  id: string;
  model: string;
  sessionId: string;
  turnId: string;
};

const MAX_STORED_RECORDS = 2_000;

export function createJsonlMemoryPlugin(options: JsonlMemoryPluginOptions): HarnessPlugin {
  return createMemoryPlugin({
    maxContextChars: options.maxContextChars,
    name: options.name ?? 'jsonl-memory',
    // This backend is intentionally simple and best suited for local testing.
    async recall(query, ctx): Promise<MemoryItem[]> {
      const records = await readStoredMemories(options.path, ctx.signal);
      return rankMemories(records, query, ctx.signal);
    },
    async remember(ctx): Promise<void> {
      const record = toStoredMemoryRecord(ctx);

      if (!record) {
        return;
      }

      await mkdir(dirname(options.path), { recursive: true });
      await appendFile(options.path, `${JSON.stringify(record)}\n`, 'utf8');
    },
    topK: options.topK,
  });
}

async function readStoredMemories(filePath: string, signal?: AbortSignal): Promise<StoredMemoryRecord[]> {
  const records: StoredMemoryRecord[] = [];
  const stream = createReadStream(filePath, { encoding: 'utf8' });
  const lines = createInterface({ crlfDelay: Number.POSITIVE_INFINITY, input: stream });

  try {
    signal?.throwIfAborted();

    for await (const rawLine of lines) {
      signal?.throwIfAborted();
      const line = rawLine.trim();

      if (line.length === 0) {
        continue;
      }

      try {
        records.push(parseStoredMemoryRecord(line));

        if (records.length > MAX_STORED_RECORDS) {
          records.shift();
        }
      } catch {
        continue;
      }
    }
  } catch (error: unknown) {
    if (isMissingPathError(error)) {
      return [];
    }

    throw error;
  } finally {
    lines.close();
    stream.destroy();
  }

  return records;
}

function parseStoredMemoryRecord(line: string): StoredMemoryRecord {
  const parsed = JSON.parse(line);

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Invalid local memory record.');
  }

  const record = parsed as Partial<StoredMemoryRecord>;

  if (
    typeof record.id !== 'string' ||
    typeof record.sessionId !== 'string' ||
    typeof record.turnId !== 'string' ||
    typeof record.model !== 'string' ||
    typeof record.createdAt !== 'string' ||
    typeof record.content !== 'string'
  ) {
    throw new Error('Invalid local memory record.');
  }

  return {
    content: record.content,
    createdAt: record.createdAt,
    id: record.id,
    model: record.model,
    sessionId: record.sessionId,
    turnId: record.turnId,
  };
}

function rankMemories(records: StoredMemoryRecord[], query: string, signal?: AbortSignal): MemoryItem[] {
  const queryTerms = new Set(tokenize(query));

  if (queryTerms.size === 0) {
    return [];
  }

  const candidates: Array<{ record: StoredMemoryRecord; score: number }> = [];

  for (const record of records) {
    signal?.throwIfAborted();
    const score = getTermOverlapScore(record.content, queryTerms);

    if (score > 0) {
      candidates.push({ record, score });
    }
  }

  candidates.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }

    return right.record.createdAt.localeCompare(left.record.createdAt);
  });

  return candidates.map(({ record, score }) => ({
    content: record.content,
    id: record.id,
    score,
    source: `local-memory:${record.sessionId}`,
    title: record.turnId,
  }));
}

function getTermOverlapScore(content: string, queryTerms: ReadonlySet<string>): number {
  let score = 0;

  for (const token of new Set(tokenize(content))) {
    if (queryTerms.has(token)) {
      score += 1;
    }
  }

  return score;
}

function toStoredMemoryRecord(ctx: MemoryRememberContext): StoredMemoryRecord | null {
  const userMessage = ctx.turnMessages.find((message) => message.role === 'user');
  const assistantMessage = [...ctx.turnMessages].reverse().find((message) => message.role === 'assistant');

  if (!userMessage || !assistantMessage) {
    return null;
  }

  const content = [`User: ${userMessage.content.trim()}`, `Assistant: ${assistantMessage.content.trim()}`]
    .filter((section) => !section.endsWith(': '))
    .join('\n');

  if (!content.trim()) {
    return null;
  }

  return {
    content,
    createdAt: new Date().toISOString(),
    id: ctx.turnId,
    model: ctx.model,
    sessionId: ctx.sessionId,
    turnId: ctx.turnId,
  };
}

function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

function isMissingPathError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
