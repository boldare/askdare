/**
 * Reads the knowledge folder the way `askdare kb sync` does (packages/askdare/src/openai/
 * knowledge-sync.ts, copied, not imported): same supported files, front matter, manifest and
 * content hash. Adds text extraction, which OpenAI did for us until now. PDF/DOCX/PPTX are out of
 * scope for the spike (see FINDINGS.md: extraction is the real cost of leaving file_search).
 */
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { basename, extname, join, relative, sep } from 'node:path';
import type { KnowledgeDocument } from './port.ts';

const MANIFEST = 'askdare.kb.json';
const TEXT = new Set(['.md', '.mdx', '.txt', '.html', '.htm', '.json']);

type Meta = { readonly title?: string; readonly url?: string };

function frontMatter(text: string): { meta: Meta; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!match?.[1]) return { meta: {}, body: text };
  const meta: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const field = /^(title|url):\s*(.+?)\s*$/.exec(line);
    if (field?.[1] && field[2]) meta[field[1]] = field[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return { meta, body: text.slice(match[0].length) };
}

/** Good enough for the fixture; a real version would use a parser (see FINDINGS.md). */
function htmlToMarkdownish(html: string): string {
  // Repeat until stable, so removing one tag can't leave another one behind (CodeQL).
  const until = (text: string, step: (s: string) => string): string => {
    let previous: string;
    let current = text;
    do {
      previous = current;
      current = step(previous);
    } while (current !== previous);
    return current;
  };
  const structured = until(html, (s) => s.replace(/<(script|style|head)[\s\S]*?<\/\1\s*>/gi, ''))
    .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, level: string, inner: string) => `\n${'#'.repeat(Number(level))} ${inner}\n`)
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<\/(p|div|ul|ol|li|table|tr)>/gi, '\n');
  // Text for embeddings only, never rendered. `&amp;` is decoded last, so it is never decoded twice.
  return until(structured, (s) => s.replace(/<[^>]*>/g, ''))
    .replace(/[<>]/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function scanFolder(root: string): Promise<KnowledgeDocument[]> {
  let manifest: Record<string, Meta> = {};
  try {
    manifest = JSON.parse(await readFile(join(root, MANIFEST), 'utf8')) as Record<string, Meta>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const documents: KnowledgeDocument[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const absolute = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(absolute);
        continue;
      }
      const path = relative(root, absolute).split(sep).join('/');
      const extension = extname(path).toLowerCase();
      if (path === MANIFEST || !TEXT.has(extension)) continue;
      const bytes = await readFile(absolute);
      const raw = bytes.toString('utf8');
      const { meta: fm, body } = /\.mdx?$/.test(extension) ? frontMatter(raw) : { meta: {}, body: raw };
      const meta: Meta = { ...fm, ...manifest[path] };
      const url = meta.url && /^https?:\/\/\S+$/i.test(meta.url) ? meta.url : undefined;
      documents.push({
        path,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        title: meta.title ?? basename(path, extension),
        url,
        text: extension === '.html' || extension === '.htm' ? htmlToMarkdownish(raw) : body,
      });
    }
  };
  await walk(root);
  return documents.sort((a, b) => a.path.localeCompare(b.path));
}
