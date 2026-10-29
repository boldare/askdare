#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { type SyncResult, syncKnowledgeFolder } from '../openai/knowledge-sync';

const USAGE = `Usage: chatdock kb sync <folder> [options]

Makes an OpenAI vector store mirror a folder of documents
(.md, .mdx, .txt, .pdf, .docx, .pptx, .html, .json). Re-running is a no-op.
Titles and URLs for citations come from markdown front matter or chatdock.kb.json.

Options:
  --store <vs_…>     Vector store to sync (default: $KB_VECTOR_STORE_ID; created when absent)
  --name <name>      Name for a newly created store
  --env-file <path>  Load environment variables from this file
                     (default: .env.local and .env in the current folder, when present)
  --dry-run          Show what would change without changing anything
  -h, --help         Show this help

Needs OPENAI_API_KEY in the environment.
`;

const STORE_ID = /^vs_[A-Za-z0-9_-]+$/;

class UsageError extends Error {}

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
    console.log(`Left alone: ${plan.unmanaged} file(s) in the store not uploaded by chatdock.`);
  }
  for (const failure of result.failed) {
    console.error(`Failed: ${failure.path} (${failure.reason})`);
  }
  if (result.created) {
    console.log('\nAdd the new store to your environment (for example .env.local):');
    console.log(`  KB_VECTOR_STORE_ID=${result.vectorStoreId}`);
  }
}

async function kbSync(args: readonly string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: [...args],
    allowPositionals: true,
    options: {
      store: { type: 'string' },
      name: { type: 'string' },
      'env-file': { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  if (values.help) {
    console.log(USAGE);
    return 0;
  }
  if (positionals.length !== 1) throw new UsageError('Expected exactly one folder.');
  // Like Next.js: the shell wins over .env.local, which wins over .env.
  const envFiles = values['env-file']
    ? [values['env-file']]
    : ['.env.local', '.env'].filter((file) => existsSync(file));
  for (const file of envFiles) process.loadEnvFile(file);
  if (envFiles.length > 0) console.log(`Loaded ${envFiles.join(', ')}.`);

  const apiKey = process.env['OPENAI_API_KEY'];
  if (!apiKey) throw new UsageError('OPENAI_API_KEY is not set.');
  const vectorStoreId = values.store ?? (process.env['KB_VECTOR_STORE_ID'] || undefined);
  if (vectorStoreId !== undefined && !STORE_ID.test(vectorStoreId)) {
    throw new UsageError('The vector store ID must look like vs_….');
  }
  const dryRun = values['dry-run'];
  const result = await syncKnowledgeFolder(apiKey, {
    root: resolve(positionals[0] ?? '.'),
    vectorStoreId,
    ...(values.name ? { name: values.name } : {}),
    dryRun,
    log: (line) => console.log(line),
  });
  report(result, dryRun);
  return result.failed.length > 0 ? 1 : 0;
}

async function main(argv: readonly string[]): Promise<number> {
  const [group, command, ...rest] = argv;
  if (group === 'kb' && command === 'sync') return kbSync(rest);
  if (group === undefined || group === '-h' || group === '--help') {
    console.log(USAGE);
    return 0;
  }
  throw new UsageError(`Unknown command "${argv.join(' ')}".`);
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    const parseError = (error as { code?: unknown }).code?.toString().startsWith('ERR_PARSE_ARGS');
    if (error instanceof UsageError || parseError)
      console.error(`${(error as Error).message}\n\n${USAGE}`);
    else console.error(`chatdock: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  },
);
