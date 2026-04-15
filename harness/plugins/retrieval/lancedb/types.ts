import type { RetrievalPluginOptions } from '../types.js';

export type LanceDbIndexDocument = {
  content: string;
  id: string;
  source: string;
  title?: string;
};

export type BuildLanceDbIndexOptions = {
  dbPath: string;
  documents: LanceDbIndexDocument[];
  embedDocuments(texts: string[]): Promise<number[][]>;
  replace?: boolean;
  tableName?: string;
};

export type HasLanceDbIndexOptions = {
  dbPath: string;
  tableName?: string;
};

export type LanceDbRetrievalPluginOptions = {
  buildQuery?: RetrievalPluginOptions['buildQuery'];
  dbPath: string;
  embedQuery(text: string): Promise<number[]>;
  formatChunks?: RetrievalPluginOptions['formatChunks'];
  maxContextChars?: number;
  name?: string;
  tableName?: string;
  topK?: number;
};
