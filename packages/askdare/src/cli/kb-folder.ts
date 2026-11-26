/**
 * Reading a knowledge folder for `askdare kb sync`, shared by both targets: an OpenAI vector store
 * and our own `KnowledgeIndex` (ADR-0025, decision 7). CLI only: it reads the file system, which
 * the library never does at runtime.
 */
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { basename, extname, join, relative, sep } from 'node:path';
import type { ChunkOptions } from '../knowledge/chunk';
import { checkKnowledgeDocuments, knowledgeDocument } from '../knowledge/document';
import { extractKnowledgeText, knowledgeFormat } from '../knowledge/extract';
import type { KnowledgeDocument } from '../knowledge/port';

/** Optional per-file titles and URLs, for files without front matter (PDFs, Word…). */
export const MANIFEST = 'askdare.kb.json';
/** OpenAI's limit for a vector store file attribute; kept on both targets, so titles match. */
const MAX_ATTRIBUTE = 512;

export interface LocalDocument {
  /** POSIX path relative to the knowledge folder; the document's identity in the store. */
  readonly path: string;
  readonly absolutePath: string;
  readonly sha256: string;
  readonly title: string;
  readonly url: string | undefined;
}

export interface FolderScan<Document> {
  /** Sorted by path. */
  readonly documents: readonly Document[];
  /** Files the target can't take, by path. */
  readonly skipped: readonly string[];
}

type Meta = { readonly title?: string; readonly url?: string };

function checkUrl(url: string | undefined, path: string): string | undefined {
  if (url === undefined) return undefined;
  if (!/^https?:\/\/\S+$/i.test(url) || url.length > MAX_ATTRIBUTE) {
    throw new Error(`${path}: url must be an http(s) URL up to ${MAX_ATTRIBUTE} characters.`);
  }
  return url;
}

async function readManifest(root: string): Promise<Record<string, Meta>> {
  try {
    return JSON.parse(await readFile(join(root, MANIFEST), 'utf8')) as Record<string, Meta>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw new Error(`${MANIFEST} is not valid JSON.`, { cause: error });
  }
}

interface ReadFile {
  readonly path: string;
  readonly absolutePath: string;
  readonly sha256: string;
  readonly title: string;
  readonly url: string | undefined;
  /** Extracted text, for the formats our own index reads; undefined for the others. */
  readonly text: string | undefined;
}

/**
 * Walks `root` (skipping dot files and node_modules) and reads every file `accept` takes, with its
 * hash and the title and URL to cite it by: the manifest wins over front matter, which wins over
 * the file name.
 */
async function readFolder(
  root: string,
  accept: (path: string) => boolean,
): Promise<{ files: ReadFile[]; skipped: string[] }> {
  const manifest = await readManifest(root);
  const files: ReadFile[] = [];
  const skipped: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const absolutePath = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }
      const path = relative(root, absolutePath).split(sep).join('/');
      if (path === MANIFEST) continue;
      if (!entry.isFile() || !accept(path)) {
        skipped.push(path);
        continue;
      }
      if (path.length > MAX_ATTRIBUTE)
        throw new Error(`${path}: path is longer than ${MAX_ATTRIBUTE}.`);
      const content = await readFile(absolutePath);
      const extracted =
        knowledgeFormat(path) === undefined
          ? undefined
          : extractKnowledgeText(path, content.toString('utf8'));
      const meta: Meta = {
        ...(extracted?.title === undefined ? {} : { title: extracted.title }),
        ...(extracted?.url === undefined ? {} : { url: extracted.url }),
        ...manifest[path],
      };
      files.push({
        path,
        absolutePath,
        sha256: createHash('sha256').update(content).digest('hex'),
        title: (meta.title ?? basename(path, extname(path))).slice(0, MAX_ATTRIBUTE),
        url: checkUrl(meta.url, path),
        text: extracted?.text,
      });
    }
  };
  await walk(root);
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  skipped.sort();
  return { files, skipped };
}

/** File types OpenAI file search indexes that make sense for a website knowledge base. */
const VECTOR_STORE_TYPES = new Set([
  '.md',
  '.mdx',
  '.txt',
  '.pdf',
  '.docx',
  '.pptx',
  '.html',
  '.htm',
  '.json',
]);

/** The folder as an OpenAI vector store takes it: every file type file search reads. */
export async function scanDirectory(root: string): Promise<FolderScan<LocalDocument>> {
  const { files, skipped } = await readFolder(root, (path) =>
    VECTOR_STORE_TYPES.has(extname(path).toLowerCase()),
  );
  return {
    documents: files.map(({ path, absolutePath, sha256, title, url }) => ({
      path,
      absolutePath,
      sha256,
      title,
      url,
    })),
    skipped,
  };
}

export interface IndexScan extends FolderScan<KnowledgeDocument> {
  /** Readable files with no text in them (an HTML page that is all script, say); not synced. */
  readonly empty: readonly string[];
}

/**
 * The folder as our own index takes it (ADR-0025, decision 8): Markdown, MDX, plain text and HTML,
 * extracted and chunked by core. Other files are skipped; the caller warns about them.
 */
export async function scanKnowledgeDocuments(
  root: string,
  options: ChunkOptions = {},
): Promise<IndexScan> {
  const { files, skipped } = await readFolder(root, (path) => knowledgeFormat(path) !== undefined);
  const documents: KnowledgeDocument[] = [];
  const empty: string[] = [];
  for (const file of files) {
    const document = knowledgeDocument(
      {
        path: file.path,
        sha256: file.sha256,
        title: file.title,
        url: file.url,
        text: file.text ?? '',
      },
      options,
    );
    if (document.chunks.length === 0) empty.push(file.path);
    else documents.push(document);
  }
  // What every index checks too, here before the CLI connects to anything.
  checkKnowledgeDocuments(documents);
  return { documents, skipped, empty };
}
