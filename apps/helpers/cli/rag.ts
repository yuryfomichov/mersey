import { access, readdir, readFile } from 'node:fs/promises';
import { basename, extname, join, relative, resolve } from 'node:path';

import {
  buildLanceDbIndex,
  createLanceDbRetrievalPlugin,
  hasLanceDbIndex,
} from '../../../harness/plugins/retrieval/lancedb/index.js';
import type { HarnessPlugin } from '../../../harness/types.js';
import { getArgValue, getBooleanFlag } from './args.js';

const DEFAULT_CHUNK_OVERLAP = 100;
const DEFAULT_CHUNK_SIZE = 800;
const DEFAULT_MAX_CONTEXT_CHARS = 2_000;
const DEFAULT_TOP_K = 3;
const HASH_EMBEDDING_DIMENSIONS = 256;

export type MarkdownRagDefinition = {
  enabled: boolean;
  indexDir: string;
  maxContextChars: number;
  rebuildIndex: boolean;
  sourceDir: string;
  topK: number;
};

export type MarkdownRagPluginResult = {
  plugin: HarnessPlugin | null;
  summaryLines: string[];
};

type CreateMarkdownRagDefinitionOptions = {
  cwd?: string;
  defaultEnabled?: boolean;
  defaultIndexDir?: string;
  defaultSourceDir?: string;
};

type IndexedMarkdownDocument = {
  content: string;
  id: string;
  source: string;
  title?: string;
};

export function getDefaultAppDataDir(cwd: string = process.cwd()): string {
  return resolve(cwd, 'apps', 'rag-cli', 'data');
}

export function getMarkdownRagDefinition(
  args: string[],
  options: CreateMarkdownRagDefinitionOptions = {},
): MarkdownRagDefinition {
  const cwd = options.cwd ?? process.cwd();
  const enabled = getBooleanFlag(args, '--rag', options.defaultEnabled ?? false);
  const sourceDir = resolve(
    cwd,
    getArgValue(args, '--rag-dir') ?? options.defaultSourceDir ?? getDefaultAppDataDir(cwd),
  );
  const rebuildIndex = getBooleanFlag(args, '--rebuild-rag');
  const indexDir = resolve(
    cwd,
    getArgValue(args, '--rag-index-dir') ?? options.defaultIndexDir ?? join('tmp', 'rag', 'data'),
  );
  const topK = getOptionalIntegerArg(args, '--rag-top-k') ?? DEFAULT_TOP_K;
  const maxContextChars = getOptionalIntegerArg(args, '--rag-max-context-chars') ?? DEFAULT_MAX_CONTEXT_CHARS;

  assertPositiveInteger(topK, '--rag-top-k');
  assertPositiveInteger(maxContextChars, '--rag-max-context-chars');

  return {
    enabled,
    indexDir,
    maxContextChars,
    rebuildIndex,
    sourceDir,
    topK,
  };
}

export async function createMarkdownRagPlugin(definition: MarkdownRagDefinition): Promise<MarkdownRagPluginResult> {
  if (!definition.enabled) {
    return {
      plugin: null,
      summaryLines: ['rag: disabled'],
    };
  }

  const canReuseExistingIndex = !definition.rebuildIndex && (await hasDataIndex(definition.indexDir));

  if (canReuseExistingIndex) {
    return {
      plugin: createConfiguredLanceDbPlugin(definition),
      summaryLines: [
        `rag: enabled (topK=${definition.topK}, index reused)`,
        `rag source: ${definition.sourceDir} (not re-read; rebuild to refresh index)`,
        `rag index: ${definition.indexDir}`,
      ],
    };
  }

  let loadedDocuments: { documents: IndexedMarkdownDocument[]; fileCount: number };

  try {
    loadedDocuments = await loadMarkdownDocuments(definition.sourceDir);
  } catch (error: unknown) {
    if (isMissingPathError(error)) {
      return {
        plugin: null,
        summaryLines: [`rag: disabled (data path not found)`, `rag source: ${definition.sourceDir}`],
      };
    }

    throw error;
  }

  const { documents, fileCount } = loadedDocuments;

  if (documents.length === 0) {
    return {
      plugin: null,
      summaryLines: [`rag: disabled (no markdown content found)`, `rag source: ${definition.sourceDir}`],
    };
  }

  const didRebuild = definition.rebuildIndex || !(await hasDataIndex(definition.indexDir));

  if (didRebuild) {
    await buildLanceDbIndex({
      dbPath: definition.indexDir,
      documents,
      embedDocuments: async (texts) => texts.map((text) => embedText(text)),
      replace: true,
    });
  }

  return {
    plugin: createConfiguredLanceDbPlugin(definition),
    summaryLines: [
      `rag: enabled (${fileCount} files, ${documents.length} chunks, topK=${definition.topK}, index ${didRebuild ? 'rebuilt' : 'reused'})`,
      `rag source: ${definition.sourceDir}`,
      `rag index: ${definition.indexDir}`,
    ],
  };
}

function createConfiguredLanceDbPlugin(definition: MarkdownRagDefinition): HarnessPlugin {
  return createLanceDbRetrievalPlugin({
    dbPath: definition.indexDir,
    embedQuery: async (text) => embedText(text),
    maxContextChars: definition.maxContextChars,
    topK: definition.topK,
  });
}

async function hasDataIndex(indexDir: string): Promise<boolean> {
  try {
    await access(indexDir);
  } catch (error: unknown) {
    if (isMissingPathError(error)) {
      return false;
    }

    throw error;
  }

  return hasLanceDbIndex({ dbPath: indexDir });
}

async function collectMarkdownFiles(rootDir: string): Promise<string[]> {
  const entries = await readdir(rootDir, { withFileTypes: true });
  const nestedPaths = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = join(rootDir, entry.name);

      if (entry.isDirectory()) {
        return collectMarkdownFiles(entryPath);
      }

      return extname(entry.name).toLowerCase() === '.md' ? [entryPath] : [];
    }),
  );

  return nestedPaths.flat().sort();
}

async function loadMarkdownDocuments(
  sourceDir: string,
): Promise<{ documents: IndexedMarkdownDocument[]; fileCount: number }> {
  const files = await collectMarkdownFiles(sourceDir);
  const documents: IndexedMarkdownDocument[] = [];

  for (const filePath of files) {
    const content = await readFile(filePath, 'utf8');
    const source = relative(sourceDir, filePath) || basename(filePath);
    const title = getFirstHeading(content) ?? basename(filePath, '.md');
    const chunks = chunkMarkdownContent(content);

    chunks.forEach((chunk, index) => {
      documents.push({
        content: chunk,
        id: `${source}#${index + 1}`,
        source,
        title,
      });
    });
  }

  return {
    documents,
    fileCount: files.length,
  };
}

function chunkMarkdownContent(content: string): string[] {
  const normalizedParagraphs = content
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  if (normalizedParagraphs.length === 0) {
    return [];
  }

  const chunks: string[] = [];
  let currentChunk = '';

  for (const paragraph of normalizedParagraphs) {
    const candidate = currentChunk ? `${currentChunk}\n\n${paragraph}` : paragraph;

    if (candidate.length <= DEFAULT_CHUNK_SIZE || currentChunk.length === 0) {
      currentChunk = candidate;
      continue;
    }

    chunks.push(currentChunk);
    currentChunk = withOverlap(currentChunk, paragraph);
  }

  if (currentChunk) {
    chunks.push(currentChunk);
  }

  return chunks;
}

function withOverlap(previousChunk: string, nextParagraph: string): string {
  const overlap = previousChunk.slice(Math.max(previousChunk.length - DEFAULT_CHUNK_OVERLAP, 0)).trim();
  return overlap ? `${overlap}\n\n${nextParagraph}` : nextParagraph;
}

function getFirstHeading(content: string): string | undefined {
  const headingLine = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.startsWith('#'));

  return headingLine ? headingLine.replace(/^#+\s*/, '').trim() : undefined;
}

function getOptionalIntegerArg(args: string[], name: string): number | undefined {
  const value = getArgValue(args, name);

  if (value === null) {
    return undefined;
  }

  if (value.trim().length === 0) {
    throw new Error(`Invalid value for ${name}: value is required.`);
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid value for ${name}: ${value}`);
  }

  return parsed;
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
}

function embedText(text: string): number[] {
  const vector = Array.from({ length: HASH_EMBEDDING_DIMENSIONS }, () => 0);
  const tokens = tokenize(text);

  if (tokens.length === 0) {
    return vector;
  }

  for (const token of tokens) {
    const index = hashToken(token) % HASH_EMBEDDING_DIMENSIONS;
    vector[index] += 1;
  }

  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));

  if (magnitude === 0) {
    return vector;
  }

  return vector.map((value) => value / magnitude);
}

function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]{2,}/g) ?? [];
}

function hashToken(token: string): number {
  let hash = 2_166_136_261;

  for (let index = 0; index < token.length; index += 1) {
    hash ^= token.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }

  return hash >>> 0;
}

function isMissingPathError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
