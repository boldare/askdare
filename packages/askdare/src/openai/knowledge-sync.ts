import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import OpenAI, { NotFoundError, toFile } from 'openai';
import { type LocalDocument, scanDirectory } from '../cli/kb-folder';

/** File search only knows these spellings, so such files are uploaded under the known one. */
const UPLOAD_EXTENSIONS: Readonly<Record<string, string>> = { '.mdx': '.md', '.htm': '.html' };

export type { LocalDocument };

export interface RemoteDocument {
  readonly fileId: string;
  /** Only `completed` copies are searchable; anything else is replaced. */
  readonly status: string;
  readonly path: string | undefined;
  readonly sha256: string | undefined;
  readonly title: string | undefined;
  readonly url: string | undefined;
}

export interface SyncPlan {
  readonly upload: readonly LocalDocument[];
  /** Same content, new title or URL: only the attributes change. */
  readonly retag: readonly { readonly document: LocalDocument; readonly fileId: string }[];
  readonly remove: readonly RemoteDocument[];
  readonly unchanged: number;
  /** Files in the store that this tool did not upload; left alone. */
  readonly unmanaged: number;
}

/** Compares the folder with the store. Pure, so the diff is easy to test and to show as a dry run. */
export function planSync(
  local: readonly LocalDocument[],
  remote: readonly RemoteDocument[],
): SyncPlan {
  const managed = remote.filter((file) => file.path !== undefined && file.sha256 !== undefined);
  const byPath = new Map<string, RemoteDocument[]>();
  for (const file of managed)
    byPath.set(file.path ?? '', [...(byPath.get(file.path ?? '') ?? []), file]);

  const upload: LocalDocument[] = [];
  const retag: { document: LocalDocument; fileId: string }[] = [];
  const remove: RemoteDocument[] = [];
  let unchanged = 0;
  for (const document of local) {
    const copies = byPath.get(document.path) ?? [];
    byPath.delete(document.path);
    const keep = copies.find(
      (copy) => copy.sha256 === document.sha256 && copy.status === 'completed',
    );
    remove.push(...copies.filter((copy) => copy !== keep));
    if (!keep) upload.push(document);
    else if (keep.title !== document.title || keep.url !== document.url) {
      retag.push({ document, fileId: keep.fileId });
    } else unchanged += 1;
  }
  for (const leftovers of byPath.values()) remove.push(...leftovers);
  return { upload, retag, remove, unchanged, unmanaged: remote.length - managed.length };
}

const attributesOf = (document: LocalDocument): Record<string, string> => ({
  path: document.path,
  sha256: document.sha256,
  title: document.title,
  ...(document.url ? { url: document.url } : {}),
});

const text = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

export interface SyncOptions {
  readonly root: string;
  /** Existing store; a new one is created when absent. */
  readonly vectorStoreId?: string | undefined;
  /** Name for a newly created store. */
  readonly name?: string;
  readonly dryRun?: boolean;
  readonly log?: (line: string) => void;
}

export interface SyncResult {
  readonly vectorStoreId: string | undefined;
  readonly created: boolean;
  readonly plan: SyncPlan;
  readonly skipped: readonly string[];
  readonly failed: readonly { readonly path: string; readonly reason: string }[];
}

async function inBatches<T>(items: readonly T[], size: number, run: (item: T) => Promise<void>) {
  for (let index = 0; index < items.length; index += size) {
    await Promise.all(items.slice(index, index + size).map(run));
  }
}

/**
 * Makes a vector store mirror a local folder. The store is the source of truth: each file carries
 * its path and content hash as attributes, so re-running is a no-op and nothing is stored locally.
 */
export async function syncKnowledge(client: OpenAI, options: SyncOptions): Promise<SyncResult> {
  const log = options.log ?? (() => {});
  const { documents, skipped } = await scanDirectory(options.root);
  let vectorStoreId = options.vectorStoreId;
  let created = false;

  const remote: RemoteDocument[] = [];
  if (vectorStoreId) {
    for await (const file of client.vectorStores.files.list(vectorStoreId, { limit: 100 })) {
      remote.push({
        fileId: file.id,
        status: file.status,
        path: text(file.attributes?.['path']),
        sha256: text(file.attributes?.['sha256']),
        title: text(file.attributes?.['title']),
        url: text(file.attributes?.['url']),
      });
    }
  }
  const plan = planSync(documents, remote);
  if (options.dryRun) return { vectorStoreId, created, plan, skipped, failed: [] };

  if (!vectorStoreId) {
    const store = await client.vectorStores.create({ name: options.name ?? 'askdare knowledge' });
    vectorStoreId = store.id;
    created = true;
    log(`Created vector store ${vectorStoreId}.`);
  }
  const storeId = vectorStoreId;
  const failed: { path: string; reason: string }[] = [];

  await inBatches(plan.upload, 4, async (document) => {
    const extension = extname(document.path);
    const name = `${basename(document.path, extension)}${UPLOAD_EXTENSIONS[extension.toLowerCase()] ?? extension}`;
    let fileId: string | undefined;
    try {
      fileId = (
        await client.files.create({
          file: await toFile(await readFile(document.absolutePath), name),
          purpose: 'assistants',
        })
      ).id;
      const attached = await client.vectorStores.files.createAndPoll(storeId, {
        file_id: fileId,
        attributes: attributesOf(document),
      });
      if (attached.status === 'completed') {
        log(`+ ${document.path}`);
        return;
      }
      failed.push({ path: document.path, reason: attached.last_error?.message ?? attached.status });
    } catch (error) {
      // One bad file must not stop the rest of the sync.
      failed.push({
        path: document.path,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
    // Files with purpose `assistants` never expire, so don't leave a failed one behind.
    if (fileId) {
      const id = fileId;
      await client.vectorStores.files.delete(id, { vector_store_id: storeId }).catch(() => {});
      await client.files.delete(id).catch(() => {});
    }
  });
  await inBatches(plan.retag, 4, async ({ document, fileId }) => {
    await client.vectorStores.files.update(fileId, {
      vector_store_id: storeId,
      attributes: attributesOf(document),
    });
    log(`~ ${document.path}`);
  });
  await inBatches(plan.remove, 4, async (file) => {
    for (const remove of [
      () => client.vectorStores.files.delete(file.fileId, { vector_store_id: storeId }),
      () => client.files.delete(file.fileId),
    ]) {
      try {
        await remove();
      } catch (error) {
        if (!(error instanceof NotFoundError)) throw error;
      }
    }
    log(`- ${file.path ?? file.fileId}`);
  });
  return { vectorStoreId: storeId, created, plan, skipped, failed };
}

/** Entry point for the CLI, which may not import `openai` itself (ADR-0002). */
export function syncKnowledgeFolder(apiKey: string, options: SyncOptions): Promise<SyncResult> {
  return syncKnowledge(new OpenAI({ apiKey, maxRetries: 3, timeout: 120_000 }), options);
}
