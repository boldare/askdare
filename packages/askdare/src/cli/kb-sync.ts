import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { Embedder } from '../knowledge/port';
import { openaiEmbedder } from '../openai/embedder';
import { type SyncResult, syncKnowledgeFolder } from '../openai/knowledge-sync';
import {
  loadFromProject,
  loadPgvectorIndex,
  type ModuleLoader,
  reportIndexSync,
  syncKnowledgeIndex,
} from './kb-index';
import { UsageError } from './usage';

export const KB_USAGE = `Usage: npx @boldare/askdare kb sync <folder> [options]

Makes an OpenAI vector store, or your own knowledge index in Postgres, mirror a
folder of documents. Re-running is a no-op. Titles and URLs for citations come from
markdown front matter or askdare.kb.json.

To an OpenAI vector store (the default; .md, .mdx, .txt, .pdf, .docx, .pptx, .html,
.htm, .json):
  --store <vs_…>        Vector store to sync (default: $KB_VECTOR_STORE_ID; created when absent)
  --name <name>         Name for a newly created store

To your own index (.md, .markdown, .mdx, .txt, .html, .htm; other files are skipped
with a warning). Needs @boldare/askdare-postgres and DATABASE_URL:
  --index <id>          Index to sync, usually the bot's ID
  --embedding-model <m> OpenAI embedding model (default: $ASKDARE_EMBEDDING_MODEL)
  --dimensions <n>      Vector size (default: $ASKDARE_EMBEDDING_DIMENSIONS)
                        Use the same model and size as the bot's openaiEmbedder.

Options:
  --env-file <path>     Load environment variables from this file
                        (default: .env.local and .env in the current folder, when present)
  --dry-run             Show what would change without changing anything
  -h, --help            Show this help

Needs OPENAI_API_KEY in the environment.
`;

const STORE_ID = /^vs_[A-Za-z0-9_-]+$/;
const INDEX_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;

/** What `kbSync` reaches outside the process through; replaced in tests. */
export interface KbSyncDependencies {
  readonly load?: ModuleLoader;
  readonly embedder?: (options: { model: string; dimensions: number; apiKey: string }) => Embedder;
}

function embeddingOptions(
  model: string | undefined,
  dimensions: string | undefined,
): { model: string; dimensions: number } {
  if (!model) {
    throw new UsageError(
      '--index needs an embedding model: pass --embedding-model or set ASKDARE_EMBEDDING_MODEL.',
    );
  }
  if (!dimensions) {
    throw new UsageError(
      '--index needs the vector size: pass --dimensions or set ASKDARE_EMBEDDING_DIMENSIONS.',
    );
  }
  const size = Number(dimensions);
  if (!/^[1-9][0-9]*$/.test(dimensions) || !Number.isSafeInteger(size)) {
    throw new UsageError('--dimensions must be a positive whole number.');
  }
  return { model, dimensions: size };
}

function report(result: SyncResult, dryRun: boolean): void {
  const { plan } = result;
  const verb = dryRun ? 'Would sync' : 'Synced';
  console.log(
    `${verb}: ${plan.upload.length} added, ${plan.retag.length} retagged, ` +
      `${plan.remove.length} removed, ${plan.unchanged} unchanged.`,
  );
  if (dryRun) {
    for (const document of plan.upload) console.log(`  + ${document.path}`);
    for (const { document } of plan.retag) console.log(`  ~ ${document.path}`);
    for (const file of plan.remove) console.log(`  - ${file.path ?? file.fileId}`);
  }
  if (result.skipped.length > 0) {
    console.log(`Skipped (unsupported type): ${result.skipped.join(', ')}`);
  }
  if (plan.unmanaged > 0) {
    console.log(`Left alone: ${plan.unmanaged} file(s) in the store not uploaded by askdare.`);
  }
  for (const failure of result.failed) {
    console.error(`Failed: ${failure.path} (${failure.reason})`);
  }
  if (result.created) {
    console.log('\nAdd the new store to your environment (for example .env.local):');
    console.log(`  KB_VECTOR_STORE_ID=${result.vectorStoreId}`);
  }
}

export async function kbSync(
  args: readonly string[],
  dependencies: KbSyncDependencies = {},
): Promise<number> {
  const { values, positionals } = parseArgs({
    args: [...args],
    allowPositionals: true,
    options: {
      store: { type: 'string' },
      name: { type: 'string' },
      index: { type: 'string' },
      'embedding-model': { type: 'string' },
      dimensions: { type: 'string' },
      'env-file': { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  if (values.help) {
    console.log(KB_USAGE);
    return 0;
  }
  if (positionals.length !== 1) throw new UsageError('Expected exactly one folder.');
  // Like Next.js: the shell wins over .env.local, which wins over .env.
  const envFiles = values['env-file']
    ? [values['env-file']]
    : ['.env.local', '.env'].filter((file) => existsSync(file));
  for (const file of envFiles) process.loadEnvFile(file);
  if (envFiles.length > 0) console.log(`Loaded ${envFiles.join(', ')}.`);

  const dryRun = values['dry-run'];
  const root = resolve(positionals[0] ?? '.');
  if (values.index !== undefined) {
    return kbSyncIndex(values.index, { ...values, root, dryRun }, dependencies);
  }
  if (values['embedding-model'] !== undefined || values.dimensions !== undefined) {
    throw new UsageError('--embedding-model and --dimensions go with --index.');
  }

  const apiKey = process.env['OPENAI_API_KEY'];
  if (!apiKey) throw new UsageError('OPENAI_API_KEY is not set.');
  const vectorStoreId = values.store ?? (process.env['KB_VECTOR_STORE_ID'] || undefined);
  if (vectorStoreId !== undefined && !STORE_ID.test(vectorStoreId)) {
    throw new UsageError('The vector store ID must look like vs_….');
  }
  const result = await syncKnowledgeFolder(apiKey, {
    root,
    vectorStoreId,
    ...(values.name ? { name: values.name } : {}),
    dryRun,
    log: (line) => console.log(line),
  });
  report(result, dryRun);
  return result.failed.length > 0 ? 1 : 0;
}

async function kbSyncIndex(
  indexId: string,
  values: {
    readonly root: string;
    readonly dryRun: boolean;
    readonly store?: string | undefined;
    readonly name?: string | undefined;
    readonly 'embedding-model'?: string | undefined;
    readonly dimensions?: string | undefined;
  },
  dependencies: KbSyncDependencies,
): Promise<number> {
  if (values.store !== undefined || values.name !== undefined) {
    throw new UsageError('--index syncs your own index: leave out --store and --name.');
  }
  if (!INDEX_ID.test(indexId)) {
    throw new UsageError(
      'The index ID must be 1 to 64 letters, digits, ".", "_" or "-", starting with a letter or digit.',
    );
  }
  const print = {
    log: (line: string) => console.log(line),
    warn: (line: string) => console.error(line),
  };
  if (values.dryRun) {
    reportIndexSync(
      await syncKnowledgeIndex({
        root: values.root,
        dryRun: true,
        open: () => Promise.reject(new Error('A dry run opens no index.')),
      }),
      indexId,
      print,
    );
    return 0;
  }
  const embedding = embeddingOptions(
    values['embedding-model'] ?? (process.env['ASKDARE_EMBEDDING_MODEL'] || undefined),
    values.dimensions ?? (process.env['ASKDARE_EMBEDDING_DIMENSIONS'] || undefined),
  );
  const apiKey = process.env['OPENAI_API_KEY'];
  if (!apiKey) throw new UsageError('OPENAI_API_KEY is not set.');
  const url = process.env['DATABASE_URL'];
  if (!url) throw new UsageError('--index needs DATABASE_URL, the Postgres to keep the index in.');

  const pgvectorIndex = await loadPgvectorIndex(
    dependencies.load ?? loadFromProject(process.cwd()),
  );
  const embedder = (dependencies.embedder ?? openaiEmbedder)({ ...embedding, apiKey });
  const result = await syncKnowledgeIndex({
    root: values.root,
    open: async () => pgvectorIndex({ url, embedder, indexId }),
  });
  reportIndexSync(result, indexId, print);
  return 0;
}
