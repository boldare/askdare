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
  // Text for embeddings only, never rendered. One pass over the characters: everything between
  // `<` and `>` is a tag and never reaches the output, so no markup can survive (no regex
  // stripping, which CodeQL flags as incomplete). The contents of script, style and head are skipped.
  const SKIPPED = new Set(['script', 'style', 'head']);
  const BLOCK_END = new Set(['p', 'div', 'ul', 'ol', 'li', 'table', 'tr']);
  let out = '';
  let skipping: string | undefined;
  let i = 0;
  while (i < html.length) {
    const open = html.indexOf('<', i);
    const textEnd = open === -1 ? html.length : open;
    if (!skipping) out += html.slice(i, textEnd);
    if (open === -1) break;
    const close = html.indexOf('>', open + 1);
    if (close === -1) break; // An unclosed tag: drop the rest.
    const tag = html.slice(open + 1, close).trim().toLowerCase();
    const closing = tag.startsWith('/');
    const name = /^\/?([a-z0-9]+)/.exec(tag)?.[1] ?? '';
    if (skipping) {
      if (closing && name === skipping) skipping = undefined;
    } else if (SKIPPED.has(name) && !closing) {
      skipping = name;
    } else if (/^h[1-6]$/.test(name)) {
      out += closing ? '\n' : `\n${'#'.repeat(Number(name[1]))} `;
    } else if (name === 'li' && !closing) {
      out += '\n- ';
    } else if (closing && BLOCK_END.has(name)) {
      out += '\n';
    }
    i = close + 1;
  }
  // Escaped angle brackets become spaces; `&amp;` is decoded last, once.
  return out
    .replace(/&(lt|gt);/g, ' ')
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
