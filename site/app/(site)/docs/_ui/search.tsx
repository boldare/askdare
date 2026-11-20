'use client';

import Link from 'next/link';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';

interface Section {
  readonly slug: string;
  readonly page: string;
  readonly heading: string;
  readonly anchor: string;
  readonly text: string;
}

interface Hit extends Section {
  readonly score: number;
  readonly snippet: string;
}

const MAX_HITS = 12;

/** Every word must appear; headings count most, then page titles, then text, and guides before ADRs. */
function search(sections: readonly Section[], query: string): Hit[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];
  const hits: Hit[] = [];
  for (const section of sections) {
    const heading = section.heading.toLowerCase();
    const page = section.page.toLowerCase();
    const text = section.text.toLowerCase();
    let score = 0;
    let found = true;
    for (const term of terms) {
      // From the start of a word: "frame" finds frame-ancestors, not iframe.
      const word = new RegExp(`(^|[^a-z0-9])${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
      const inHeading = word.test(heading);
      const inPage = word.test(page);
      const inText = word.test(text);
      if (!inHeading && !inPage && !inText) {
        found = false;
        break;
      }
      score += (inHeading ? 6 : 0) + (inPage ? 3 : 0) + (inText ? 1 : 0);
    }
    if (!found) continue;
    // Guides answer "how"; decision records come after them.
    if (section.slug.startsWith('adr')) score /= 2;
    hits.push({ ...section, score, snippet: snippetOf(section.text, terms) });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, MAX_HITS);
}

function snippetOf(text: string, terms: readonly string[]): string {
  const lower = text.toLowerCase();
  const at = terms.map((term) => lower.indexOf(term)).find((index) => index >= 0) ?? 0;
  const start = Math.max(0, at - 50);
  return `${start > 0 ? '…' : ''}${text.slice(start, start + 150)}${start + 150 < text.length ? '…' : ''}`;
}

/** The search box: a button in the bar, and ⌘K or Ctrl+K anywhere in the docs. */
export function Search() {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [sections, setSections] = useState<readonly Section[] | undefined>();
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState('');
  const listId = useId();
  const hits = useMemo(() => (sections ? search(sections, query) : []), [sections, query]);

  const open = useCallback(() => {
    dialog.current?.showModal();
    input.current?.select();
    if (sections) return;
    // Loaded on first use: about 25 pages of text.
    fetch('/docs/search.json')
      .then((response) => response.json() as Promise<Section[]>)
      .then(setSections)
      .catch(() => setFailed(true));
  }, [sections]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        open();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // Arrow keys move between the results; typing goes back to the field.
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const links = [...(dialog.current?.querySelectorAll<HTMLAnchorElement>('.d-hits a') ?? [])];
    if (links.length === 0) return;
    event.preventDefault();
    const index = links.indexOf(document.activeElement as HTMLAnchorElement);
    const next =
      event.key === 'ArrowDown'
        ? links[Math.min(index + 1, links.length - 1)]
        : index <= 0
          ? undefined
          : links[index - 1];
    (next ?? input.current)?.focus();
  };

  const close = () => dialog.current?.close();

  return (
    <>
      <button
        type="button"
        className="d-search-button"
        onClick={open}
        aria-keyshortcuts="Meta+K Control+K"
      >
        <span className="d-search-icon" />
        <span className="d-search-text">Search the docs</span>
        <kbd>⌘K</kbd>
      </button>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: a backdrop click closes it; Escape is built into dialog */}
      <dialog
        ref={dialog}
        className="d-search"
        aria-label="Search the docs"
        onClick={(event) => {
          if (event.target === event.currentTarget) close();
        }}
      >
        {/* biome-ignore lint/a11y/noStaticElementInteractions: arrow keys move between results */}
        <div className="d-search-panel" onKeyDown={onKeyDown}>
          <input
            ref={input}
            type="search"
            placeholder="Search the docs"
            aria-label="Search the docs"
            aria-controls={listId}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div id={listId} className="d-hits" aria-live="polite">
            {failed ? (
              <p className="d-hits-empty">Search couldn’t load. Use the page list instead.</p>
            ) : query && sections && hits.length === 0 ? (
              <p className="d-hits-empty">Nothing found for “{query}”.</p>
            ) : (
              <ul>
                {hits.map((hit) => (
                  <li key={`${hit.slug}#${hit.anchor}`}>
                    <Link
                      href={`/docs/${hit.slug}${hit.anchor ? `#${hit.anchor}` : ''}`}
                      onClick={close}
                    >
                      <span className="d-hit-title">
                        {hit.heading === hit.page ? hit.page : `${hit.page} › ${hit.heading}`}
                      </span>
                      <span className="d-hit-text">{hit.snippet}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </dialog>
    </>
  );
}
