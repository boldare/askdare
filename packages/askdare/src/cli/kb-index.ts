/**
 * The index target of `askdare kb sync` (ADR-0025, decision 7): the folder, extracted and chunked by
 * core, into a `KnowledgeIndex`. The CLI builds the index; the library never reads the folder.
 */
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ChunkOptions } from '../knowledge/chunk';
import type { Embedder, KnowledgeIndex, SyncReport } from '../knowledge/port';
import { type IndexScan, scanKnowledgeDocuments } from './kb-folder';
import { UsageError } from './usage';

export const POSTGRES_PACKAGE = '@boldare/askdare-postgres';

/** What the CLI needs from `pgvectorIndex` in the add-on; typed here, as core can't depend on it. */
export interface PgvectorIndexOptions {
  /** Connection string; the add-on falls back to `DATABASE_URL`. */
  readonly url?: string;
  readonly embedder: Embedder;
  readonly indexId: string;
}

type PgvectorIndexFactory = (options: PgvectorIndexOptions) => KnowledgeIndex;

/** An index that holds connections can end them, so the command can exit. */
type Closable = { close?: () => Promise<void> | void };

/** How the CLI loads a module; replaced in tests. */
export type ModuleLoader = (specifier: string) => Promise<unknown>;

const notFound = (error: unknown): boolean => {
  const code = (error as { code?: unknown } | undefined)?.code;
  return code === 'MODULE_NOT_FOUND' || code === 'ERR_MODULE_NOT_FOUND';
};

/**
 * Loads `@boldare/askdare-postgres` from the project in `cwd` (where it is installed when
 * `npx @boldare/askdare` runs from the npx cache), else from next to this package.
 */
export const loadFromProject =
  (cwd: string): ModuleLoader =>
  async (specifier) => {
    let resolved: string | undefined;
    try {
      resolved = createRequire(join(cwd, 'package.json')).resolve(specifier);
    } catch (error) {
      if (!notFound(error)) throw error;
    }
    return import(resolved === undefined ? specifier : pathToFileURL(resolved).href);
  };

/** `pgvectorIndex` from the add-on, with a clear message when the add-on isn't installed. */
export async function loadPgvectorIndex(load: ModuleLoader): Promise<PgvectorIndexFactory> {
  let module: unknown;
  try {
    module = await load(POSTGRES_PACKAGE);
  } catch (error) {
    if (notFound(error) && String((error as Error).message).includes(POSTGRES_PACKAGE)) {
      throw new UsageError(
        `kb sync --index needs ${POSTGRES_PACKAGE} in this project: npm install ${POSTGRES_PACKAGE}`,
      );
    }
    throw error;
  }
  const factory = (module as { pgvectorIndex?: unknown } | undefined)?.pgvectorIndex;
  if (typeof factory !== 'function') {
    throw new UsageError(
      `The installed ${POSTGRES_PACKAGE} has no pgvectorIndex: update it to the version that matches @boldare/askdare.`,
    );
  }
  return factory as PgvectorIndexFactory;
}

export interface IndexSyncResult {
  readonly scan: IndexScan;
  /** Undefined in a dry run, which reads the folder and touches no index. */
  readonly report: SyncReport | undefined;
}

export interface IndexSyncOptions {
  readonly root: string;
  /** Opened only after the folder was read and checked, so a bad file fails before any connection. */
  readonly open: () => Promise<KnowledgeIndex>;
  readonly dryRun?: boolean;
  readonly chunk?: ChunkOptions;
}

/** Reads the folder and makes the index mirror it. The index embeds only chunks it doesn't have. */
export async function syncKnowledgeIndex(options: IndexSyncOptions): Promise<IndexSyncResult> {
  const scan = await scanKnowledgeDocuments(options.root, options.chunk);
  if (options.dryRun) return { scan, report: undefined };
  const index = await options.open();
  try {
    return { scan, report: await index.sync(scan.documents) };
  } finally {
    await (index as Closable).close?.();
  }
}

const plural = (count: number, one: string, many = `${one}s`): string =>
  `${count} ${count === 1 ? one : many}`;

/** Prints what a sync to an index did: documents, chunks and embedding tokens. */
export function reportIndexSync(
  { scan, report }: IndexSyncResult,
  indexId: string,
  print: { log: (line: string) => void; warn: (line: string) => void },
): void {
  if (report === undefined) {
    const chunks = scan.documents.reduce((sum, document) => sum + document.chunks.length, 0);
    print.log(
      `Would sync ${plural(scan.documents.length, 'document')} (${plural(chunks, 'chunk')}) to the index "${indexId}". The index decides what changed.`,
    );
    for (const document of scan.documents) {
      print.log(`  ${document.path} (${plural(document.chunks.length, 'chunk')})`);
    }
  } else {
    print.log(
      `Synced to the index "${indexId}": ${report.added.length} added, ${report.changed.length} changed, ` +
        `${report.removed.length} removed, ${report.unchanged} unchanged.`,
    );
    print.log(
      `Embedded ${plural(report.embeddedChunks, 'chunk')} (${plural(report.embeddingTokens, 'token')}), ` +
        `reused ${plural(report.reusedChunks, 'chunk')}.`,
    );
    for (const path of report.added) print.log(`  + ${path}`);
    for (const path of report.changed) print.log(`  ~ ${path}`);
    for (const path of report.removed) print.log(`  - ${path}`);
  }
  if (scan.skipped.length > 0) {
    print.warn(
      `Warning: skipped ${plural(scan.skipped.length, 'file')} the index can't read ` +
        `(it reads .md, .markdown, .mdx, .txt, .html and .htm): ${scan.skipped.join(', ')}`,
    );
  }
  if (scan.empty.length > 0) {
    print.warn(`Warning: no text found in ${scan.empty.join(', ')}; not synced.`);
  }
}
