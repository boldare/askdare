/**
 * Text extraction for the own index (ADR-0025, decision 8): Markdown, MDX, plain text and HTML.
 * Pure functions on a file's text, so `askdare kb sync` reads the files and only calls these; the
 * library never reads the file system at runtime. Other formats are the CLI's to skip with a warning.
 */

export type KnowledgeFormat = 'markdown' | 'mdx' | 'text' | 'html';

const FORMATS: Readonly<Record<string, KnowledgeFormat>> = {
  '.md': 'markdown',
  '.markdown': 'markdown',
  '.mdx': 'mdx',
  '.txt': 'text',
  '.html': 'html',
  '.htm': 'html',
};

export interface ExtractedText {
  /** Markdown-ish plain text: headings stay as `#` lines, so the chunker can follow them. */
  readonly text: string;
  /** From front matter (Markdown and MDX); the CLI falls back to the manifest and the file name. */
  readonly title: string | undefined;
  readonly url: string | undefined;
}

/** The format of a knowledge file by its extension, or undefined when the own index can't read it. */
export function knowledgeFormat(path: string): KnowledgeFormat | undefined {
  const dot = path.lastIndexOf('.');
  if (dot <= path.lastIndexOf('/')) return undefined;
  return FORMATS[path.slice(dot).toLowerCase()];
}

/** `title` and `url` from YAML front matter, read as `askdare kb sync` reads them for vector stores. */
function frontMatter(text: string): { title?: string; url?: string; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!match?.[1]) return { body: text };
  const meta: { title?: string; url?: string } = {};
  for (const line of match[1].split(/\r?\n/)) {
    const field = /^(title|url):\s*(.+?)\s*$/.exec(line);
    if (field?.[1] && field[2])
      meta[field[1] as 'title' | 'url'] = field[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return { ...meta, body: text.slice(match[0].length) };
}

/** MDX without its ESM blocks (`import`/`export` paragraphs) and `{/* comments *\/}`. */
function mdxText(body: string): string {
  return body
    .replace(/\r\n?/g, '\n')
    .split(/\n[ \t]*\n/)
    .filter((block) => !/^\s*(import|export)\s/.test(block))
    .join('\n\n')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
}

const SKIPPED_ELEMENTS = new Set(['script', 'style', 'head', 'template', 'noscript', 'svg']);
const BLOCK_ELEMENTS = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'br',
  'dd',
  'div',
  'dl',
  'dt',
  'figcaption',
  'figure',
  'footer',
  'header',
  'hr',
  'main',
  'nav',
  'ol',
  'p',
  'pre',
  'section',
  'table',
  'tr',
  'ul',
]);
const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  nbsp: ' ',
  quot: '"',
  apos: "'",
  lt: ' ',
  gt: ' ',
};

function decodeEntities(text: string): string {
  // Angle brackets become spaces, so no markup reappears; `&amp;` is decoded last, once.
  return text
    .replace(/&#(x[0-9a-f]+|[0-9]+);/gi, (_, code: string) => {
      const point =
        code[0] === 'x' || code[0] === 'X' ? Number.parseInt(code.slice(1), 16) : Number(code);
      if (
        !Number.isInteger(point) ||
        point < 32 ||
        point > 0x10ffff ||
        point === 60 ||
        point === 62
      )
        return ' ';
      return String.fromCodePoint(point);
    })
    .replace(
      /&(nbsp|quot|apos|lt|gt);/gi,
      (_, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? ' ',
    )
    .replace(/&amp;/gi, '&');
}

/**
 * Text of an HTML page in one pass over the characters (S8's final version): everything between `<`
 * and `>` is a tag and never reaches the output, so no markup survives, with no regex stripping.
 * Headings become `#` lines and list items `- ` lines. Never rendered: it is embedded and read by
 * the model as untrusted text.
 */
function htmlText(html: string): string {
  let out = '';
  let skipping: string | undefined;
  let i = 0;
  while (i < html.length) {
    const open = html.indexOf('<', i);
    const textEnd = open === -1 ? html.length : open;
    if (skipping === undefined) out += html.slice(i, textEnd).replace(/\s+/g, ' ');
    if (open === -1) break;
    if (html.startsWith('<!--', open)) {
      const close = html.indexOf('-->', open + 4);
      if (close === -1) break;
      i = close + 3;
      continue;
    }
    const close = html.indexOf('>', open + 1);
    if (close === -1) break; // An unclosed tag: drop the rest.
    const tag = html
      .slice(open + 1, close)
      .trim()
      .toLowerCase();
    const closing = tag.startsWith('/');
    const name = /^\/?([a-z][a-z0-9-]*)/.exec(tag)?.[1] ?? '';
    if (skipping !== undefined) {
      if (closing && name === skipping) skipping = undefined;
    } else if (SKIPPED_ELEMENTS.has(name) && !closing && !tag.endsWith('/')) {
      skipping = name;
    } else if (/^h[1-6]$/.test(name)) {
      out += closing ? '\n\n' : `\n\n${'#'.repeat(Number(name[1]))} `;
    } else if (name === 'li' && !closing) {
      out += '\n- ';
    } else if (name === 'li' || (name === 'tr' && closing)) {
      // Rows and items end where the next one starts, so a list or table stays one block.
    } else if (BLOCK_ELEMENTS.has(name)) {
      out +=
        name === 'p' ||
        name === 'table' ||
        name === 'ul' ||
        name === 'ol' ||
        name === 'pre' ||
        name === 'section'
          ? '\n\n'
          : '\n';
    } else if ((name === 'td' || name === 'th') && !closing) {
      out += ' | ';
    }
    i = close + 1;
  }
  return decodeEntities(out)
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Extracts the text of one knowledge file, or undefined for a format the own index can't read. */
export function extractKnowledgeText(path: string, content: string): ExtractedText | undefined {
  const format = knowledgeFormat(path);
  if (format === undefined) return undefined;
  const source = content.replace(/^﻿/, '');
  if (format === 'html') return { text: htmlText(source), title: undefined, url: undefined };
  if (format === 'text') {
    return { text: source.replace(/\r\n?/g, '\n').trim(), title: undefined, url: undefined };
  }
  const { title, url, body } = frontMatter(source);
  const text = (format === 'mdx' ? mdxText(body) : body.replace(/\r\n?/g, '\n')).trim();
  return { text, title, url };
}
