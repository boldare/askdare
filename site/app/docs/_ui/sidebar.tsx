'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useId, useState } from 'react';

interface Group {
  readonly title: string;
  readonly pages: readonly { readonly slug: string; readonly title: string }[];
}

/**
 * The docs' page list. Wide screens show it beside the page; phones open it from a button above
 * the page, and it closes again when a page is picked.
 */
export function Sidebar({ groups }: { readonly groups: readonly Group[] }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const listId = useId();

  // A new page closes the list on phones.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs on navigation only
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const current = groups.flatMap((group) => group.pages).find((page) => isCurrent(page.slug));
  function isCurrent(slug: string): boolean {
    return pathname === `/docs/${slug}`;
  }

  return (
    <nav className="d-side" aria-label="Docs" data-open={open || undefined}>
      <button
        type="button"
        className="d-side-toggle"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="d-side-label">{current?.title ?? 'All pages'}</span>
        <span aria-hidden="true" className="d-chevron" />
      </button>
      <div className="d-side-list" id={listId}>
        <Link
          href="/docs"
          className="d-side-home"
          aria-current={pathname === '/docs' ? 'page' : undefined}
        >
          Overview
        </Link>
        {groups.map((group) => (
          <div key={group.title} className="d-side-group">
            <p>{group.title}</p>
            <ul>
              {group.pages.map((page) => (
                <li key={page.slug}>
                  <Link
                    href={`/docs/${page.slug}`}
                    aria-current={
                      isCurrent(page.slug) ||
                      (page.slug === 'adr' && pathname.startsWith('/docs/adr/'))
                        ? 'page'
                        : undefined
                    }
                  >
                    {page.title}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );
}
