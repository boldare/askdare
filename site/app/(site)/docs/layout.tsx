import Image from 'next/image';
import type { ReactNode } from 'react';
import { ChatScript } from '../chat-script';
import { GITHUB_URL, GitHubIcon, NPM_URL, NpmIcon } from '../project-links';
import { NAV, titles } from './_lib/content';
import { Search } from './_ui/search';
import { Sidebar } from './_ui/sidebar';
import './docs.css';

export default async function DocsLayout({ children }: { readonly children: ReactNode }) {
  const names = await titles();
  const groups = NAV.map((group) => ({
    title: group.title,
    pages: group.pages.map((slug) => ({ slug, title: names.get(slug) ?? slug })),
  }));
  return (
    <div className="docs">
      <a className="d-skip" href="#content">
        Skip to content
      </a>
      <header className="d-bar">
        {/* Full page loads to and from the home page: each loads its own chat. */}
        <a className="brand" href="/" aria-label="askdare home">
          <Image src="/boldare-logo.svg" alt="" width={133} height={16} priority unoptimized />
        </a>
        <a className="product" href="/docs">
          askdare
          <small>Documentation</small>
        </a>
        <Search />
        <nav className="d-bar-links" aria-label="Site">
          <a href="/">Home</a>
          <a href={GITHUB_URL}>
            <GitHubIcon />
            GitHub
          </a>
          <a href={NPM_URL}>
            <NpmIcon />
            npm
          </a>
        </nav>
      </header>
      <div className="d-body">
        <Sidebar groups={groups} />
        <div className="d-main" id="content">
          {children}
        </div>
      </div>
      {/* The docs answer questions about themselves once they are synced (site/scripts/docs-kb.mjs). */}
      {process.env.DOCS_VECTOR_STORE_ID ? <ChatScript bot="docs" /> : null}
    </div>
  );
}
