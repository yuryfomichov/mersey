import { connect } from '@lancedb/lancedb';

import type { HarnessPlugin, PrepareProviderRequestContext } from '../../../runtime/plugins/types.js';
import { createRetrievalPlugin } from '../retrieval.js';
import type { RetrievedChunk } from '../types.js';
import type {
  BuildLanceDbIndexOptions,
  HasLanceDbIndexOptions,
  LanceDbIndexDocument,
  LanceDbRetrievalPluginOptions,
} from './types.js';

type LanceDbRow = LanceDbIndexDocument & {
  _distance?: number;
  vector: number[];
};

type LanceDbTable = Awaited<ReturnType<Awaited<ReturnType<typeof connect>>['openTable']>>;

const DEFAULT_TABLE_NAME = 'documents';

export async function buildLanceDbIndex(options: BuildLanceDbIndexOptions): Promise<void> {
  if (options.documents.length === 0) {
    throw new Error('Cannot build a LanceDB index without documents.');
  }

  const texts = options.documents.map((document) => document.content);
  const vectors = await options.embedDocuments(texts);
  const rows = createRows(options.documents, vectors);
  const db = await connect(options.dbPath);
  const tableName = options.tableName ?? DEFAULT_TABLE_NAME;

  if (options.replace) {
    await db.createTable(tableName, rows, { mode: 'overwrite' });
    return;
  }

  try {
    const table = await db.openTable(tableName);
    await table.add(rows);
  } catch (error: unknown) {
    if (!isMissingTableError(error)) {
      throw error;
    }

    await db.createTable(tableName, rows);
  }
}

export function createLanceDbRetrievalPlugin(options: LanceDbRetrievalPluginOptions): HarnessPlugin {
  const tableName = options.tableName ?? DEFAULT_TABLE_NAME;
  let tablePromise: Promise<LanceDbTable> | undefined;

  function getTable() {
    tablePromise ??= connect(options.dbPath)
      .then((db) => db.openTable(tableName))
      .catch((error: unknown) => {
        tablePromise = undefined;
        throw error;
      });

    return tablePromise;
  }

  return createRetrievalPlugin({
    buildQuery: options.buildQuery,
    formatChunks: options.formatChunks,
    maxContextChars: options.maxContextChars,
    name: options.name ?? 'lancedb-retrieval',
    async retrieve(query: string, ctx: PrepareProviderRequestContext): Promise<RetrievedChunk[]> {
      ctx.signal?.throwIfAborted();
      const vector = await options.embedQuery(query);
      ctx.signal?.throwIfAborted();
      ensureVector(vector, 'query embedding');
      if (isZeroVector(vector)) {
        return [];
      }

      const table = await getTable();
      ctx.signal?.throwIfAborted();
      const rows = (await table
        .vectorSearch(vector)
        .limit(options.topK ?? 5)
        .toArray()) as LanceDbRow[];

      return rows.map((row, index) => toRetrievedChunk(row, index));
    },
    topK: options.topK,
  });
}

export async function hasLanceDbIndex(options: HasLanceDbIndexOptions): Promise<boolean> {
  try {
    const db = await connect(options.dbPath);
    await db.openTable(options.tableName ?? DEFAULT_TABLE_NAME);
    return true;
  } catch (error: unknown) {
    if (isMissingTableError(error)) {
      return false;
    }

    throw error;
  }
}

function isMissingTableError(error: unknown): boolean {
  return error instanceof Error && /table .*not found|does not exist|was not found/i.test(error.message);
}

function ensureVector(vector: number[], label: string): void {
  if (!Array.isArray(vector) || vector.length === 0 || vector.some((value) => !Number.isFinite(value))) {
    throw new Error(`${label} must be a non-empty numeric vector.`);
  }
}

function isZeroVector(vector: number[]): boolean {
  return vector.every((value) => value === 0);
}

function createRows(documents: LanceDbIndexDocument[], vectors: number[][]): LanceDbRow[] {
  if (vectors.length !== documents.length) {
    throw new Error('Embedding count must match document count when building a LanceDB index.');
  }

  return documents.map((document, index) => {
    const vector = vectors[index];

    ensureVector(vector, `embedding ${index + 1}`);

    return {
      ...document,
      vector,
    };
  });
}

function toRetrievedChunk(row: LanceDbRow, index: number): RetrievedChunk {
  return {
    content: typeof row.content === 'string' ? row.content : '',
    id: typeof row.id === 'string' ? row.id : `chunk-${index + 1}`,
    score: typeof row._distance === 'number' ? row._distance : undefined,
    source: typeof row.source === 'string' ? row.source : undefined,
    title: typeof row.title === 'string' ? row.title : undefined,
  };
}
