import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import rehypeShiki from '@shikijs/rehype';
import type { Element, ElementContent, Root } from 'hast';
import { toJsxRuntime } from 'hast-util-to-jsx-runtime';
import { toString as textOf } from 'hast-util-to-string';
import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';
import { Fragment, jsx, jsxs } from 'react/jsx-runtime';
import rehypeSlug from 'rehype-slug';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';
import { visit } from 'unist-util-visit';
import { CodeBlock } from '../_ui/code-block';

// The docs are rendered at build time from the repository's docs/ (ADR-0010): pages are static,
// so these files are read during `next build` only.
// turbopackIgnore: the files are read at build time, so the server output needn't trace them.
const REPO = path.join(/* turbopackIgnore: true */ process.cwd(), '..');
const GITHUB = 'https://github.com/boldare/askdare';
/** Contributor-only guides stay in the repository, as in the npm package. */
const UNPUBLISHED = new Set(['docs/live-testing.md']);

/** The sidebar. Every published guide must be in it; the build fails otherwise. */
export const NAV: readonly { readonly title: string; readonly pages: readonly string[] }[] = [
  {
    title: 'Start',
    pages: ['getting-started', 'embedding', 'configuration', 'cli', 'troubleshooting'],
  },
  {
    title: 'Features',
    pages: ['knowledge-base', 'tools', 'attachments', 'voice-input', 'identity'],
  },
  { title: 'Look and feel', pages: ['styling', 'themes', 'texts'] },
  {
    title: 'Running it',
    pages: ['deployment', 'going-public', 'costs', 'privacy', 'custom-store', 'support'],
  },
  { title: 'Reference', pages: ['protocol', 'migrating-from-openai-assistant', 'adr'] },
];

export interface TocEntry {
  readonly id: string;
  readonly text: string;
  readonly depth: 2 | 3;
}

export interface Page {
  readonly slug: string;
  /** Repository path, e.g. `docs/getting-started.md`. */
  readonly file: string;
  readonly title: string;
  readonly description: string;
  readonly toc: readonly TocEntry[];
  readonly body: ReactNode;
}

export interface SearchSection {
  readonly slug: string;
  readonly page: string;
  readonly heading: string;
  readonly anchor: string;
  readonly text: string;
}

const slugOfFile = (file: string): string | undefined => {
  if (!file.startsWith('docs/') || !file.endsWith('.md') || UNPUBLISHED.has(file)) return undefined;
  const slug = file.slice('docs/'.length, -'.md'.length);
  return slug === 'adr/README' ? 'adr' : slug;
};

/** Every published file, by slug. */
const files = (): ReadonlyMap<string, string> => {
  const list = [
    ...readdirSync(path.join(REPO, 'docs')).map((name) => `docs/${name}`),
    ...readdirSync(path.join(REPO, 'docs/adr')).map((name) => `docs/adr/${name}`),
  ];
  const map = new Map<string, string>();
  for (const file of list) {
    const slug = slugOfFile(file);
    if (slug) map.set(slug, file);
  }
  const listed = new Set(NAV.flatMap((group) => group.pages));
  const missing = [...map.keys()].filter((slug) => !slug.startsWith('adr/') && !listed.has(slug));
  if (missing.length > 0) {
    throw new Error(`docs: add ${missing.join(', ')} to NAV in site/app/docs/_lib/content.ts`);
  }
  return map;
};

/** A link inside a guide: to another published page, or to the file on GitHub. */
const rewriteHref = (href: string, file: string, published: ReadonlySet<string>): string => {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('#') || href.startsWith('/')) {
    return href;
  }
  const [target = '', hash] = href.split('#');
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(file), target));
  const suffix = hash ? `#${hash}` : '';
  const slug = slugOfFile(resolved);
  if (slug && published.has(slug)) return `/docs/${slug}${suffix}`;
  return `${GITHUB}/blob/main/${resolved}${suffix}`;
};

const rehypeDocs =
  (file: string, published: ReadonlySet<string>) =>
  () =>
  (tree: Root): void => {
    visit(tree, 'element', (node, index, parent) => {
      if (node.tagName === 'a' && typeof node.properties['href'] === 'string') {
        node.properties['href'] = rewriteHref(node.properties['href'], file, published);
      }
      // Wide tables scroll on their own, not the page.
      if (node.tagName === 'table' && parent && index !== undefined) {
        const wrapper: Element = {
          type: 'element',
          tagName: 'div',
          // Focusable, so keyboard users can scroll it too.
          properties: { className: ['table'], tabIndex: 0 },
          children: [node],
        };
        parent.children[index] = wrapper;
      }
    });
  };

const render = async (file: string, published: ReadonlySet<string>): Promise<Root> => {
  const markdown = readFileSync(path.join(REPO, file), 'utf8');
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    // No allowDangerousHtml: raw HTML in Markdown is dropped, never rendered.
    .use(remarkRehype)
    .use(rehypeSlug)
    .use(rehypeDocs(file, published))
    .use(rehypeShiki, {
      // High-contrast themes keep every token at 4.5:1 or more on our code backgrounds.
      themes: { light: 'github-light-high-contrast', dark: 'github-dark-high-contrast' },
      defaultColor: false,
      fallbackLanguage: 'text',
    });
  return processor.run(processor.parse(markdown));
};

const headingDepth = (node: ElementContent): 1 | 2 | 3 | undefined => {
  if (node.type !== 'element') return undefined;
  return node.tagName === 'h1'
    ? 1
    : node.tagName === 'h2'
      ? 2
      : node.tagName === 'h3'
        ? 3
        : undefined;
};

/** Links between guides navigate inside the app; others open as usual. */
const DocLink = ({ href = '', ...props }: ComponentProps<'a'>): ReactNode =>
  href.startsWith('/docs')
    ? jsx(Link, { href, ...props })
    : jsx('a', { href, ...props, ...(/^https?:/.test(href) ? { rel: 'noopener' } : {}) });

const cache = new Map<string, Promise<{ page: Page; sections: SearchSection[] }>>();

const build = async (slug: string): Promise<{ page: Page; sections: SearchSection[] }> => {
  const all = files();
  const file = all.get(slug);
  if (!file) throw new Error(`docs: no page ${slug}`);
  const tree = await render(file, new Set(all.keys()));
  let title = slug;
  let description = '';
  const toc: TocEntry[] = [];
  const sections: SearchSection[] = [];
  let current = { heading: '', anchor: '', text: [] as string[] };
  const flush = () => {
    const text = current.text.join(' ').replace(/\s+/g, ' ').trim();
    if (current.heading || text) {
      sections.push({
        slug,
        page: title,
        heading: current.heading || title,
        anchor: current.anchor,
        text: text.slice(0, 600),
      });
    }
  };
  for (const node of tree.children as ElementContent[]) {
    const depth = headingDepth(node);
    if (depth === 1) {
      title = textOf(node);
      continue;
    }
    if (depth && node.type === 'element') {
      const id = String(node.properties['id'] ?? '');
      const text = textOf(node);
      toc.push({ id, text, depth });
      flush();
      current = { heading: text, anchor: id, text: [] };
      continue;
    }
    if (node.type === 'element') {
      if (!description && node.tagName === 'p') description = textOf(node);
      // Code is searchable by its words, but kept short.
      current.text.push(node.tagName === 'pre' ? textOf(node).slice(0, 200) : textOf(node));
    }
  }
  flush();
  const body = toJsxRuntime(tree, {
    Fragment,
    jsx,
    jsxs,
    components: { pre: CodeBlock, a: DocLink },
  });
  return {
    page: { slug, file, title, description: description.slice(0, 200), toc, body },
    sections,
  };
};

const built = (slug: string) => {
  let result = cache.get(slug);
  if (!result) {
    result = build(slug);
    cache.set(slug, result);
  }
  return result;
};

export const slugs = (): readonly string[] => [...files().keys()];

export const getPage = async (slug: string): Promise<Page> => (await built(slug)).page;

export const searchIndex = async (): Promise<readonly SearchSection[]> =>
  (await Promise.all(slugs().map((slug) => built(slug)))).flatMap((result) => result.sections);

/** Titles for the sidebar and the previous and next links. */
export const titles = async (): Promise<ReadonlyMap<string, string>> =>
  new Map(
    await Promise.all(slugs().map(async (slug) => [slug, (await getPage(slug)).title] as const)),
  );

/** The pages around this one, in sidebar order. ADRs have none. */
export const neighbours = (slug: string): { previous?: string; next?: string } => {
  const order = NAV.flatMap((group) => group.pages);
  const index = order.indexOf(slug);
  if (index === -1) return {};
  return {
    ...(index > 0 ? { previous: order[index - 1] } : {}),
    ...(index < order.length - 1 ? { next: order[index + 1] } : {}),
  };
};

export const editUrl = (file: string): string => `${GITHUB}/edit/main/${file}`;
