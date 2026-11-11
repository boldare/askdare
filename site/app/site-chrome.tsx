import Image from 'next/image';
import { NavMenu } from './nav-menu';
import { GITHUB_URL, NPM_URL } from './project-links';

interface Link {
  readonly href: string;
  readonly label: string;
}

/** The bar on the home page and `/deploy`: Boldare, the product and its slogan, the menu. */
export function SiteHeader({
  links,
  action,
}: {
  readonly links: readonly Link[];
  readonly action: Link;
}) {
  return (
    <header className="nav">
      <a className="brand" href="https://www.boldare.com" aria-label="Boldare">
        <Image src="/boldare-logo.svg" alt="Boldare" width={133} height={16} priority unoptimized />
      </a>
      <a className="product" href="/">
        askdare
        <small>Dare to ask.</small>
      </a>
      <NavMenu links={links} action={action} />
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="footer">
      <Image src="/boldare-logo.svg" alt="Boldare" width={100} height={12} unoptimized />
      <p>
        askdare is an open-source project by <a href="https://www.boldare.com">Boldare</a>. MIT
        licensed.
      </p>
      <nav className="footer-links" aria-label="Docs and project">
        <a href="/docs">Docs</a>
        <a href="/docs/getting-started">Getting started</a>
        <a href="/deploy">Deploy in 5 minutes</a>
        <a href="/docs/configuration">Configuration</a>
        <a href="/docs/troubleshooting">Troubleshooting</a>
        <a href={GITHUB_URL}>GitHub</a>
        <a href={NPM_URL}>npm</a>
      </nav>
    </footer>
  );
}

/** The Vercel triangle, as in Vercel's own deploy button. */
export function VercelIcon() {
  return (
    <svg className="vercel-icon" viewBox="0 0 76 65" aria-hidden="true" focusable="false">
      <path d="M37.53 0 75.06 65H0z" fill="currentColor" />
    </svg>
  );
}
