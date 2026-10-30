'use client';

import { type CSSProperties, useEffect, useId, useRef, useState } from 'react';

interface Link {
  readonly href: string;
  readonly label: string;
}

/**
 * The page's links and its main action. Wide screens show them in the bar. Phones get a round
 * button that opens them as a full-screen sheet: large numbered links, the action at the bottom.
 * While it is open the page doesn't scroll, focus stays in the menu, and a link, Escape or the
 * button closes it.
 */
export function NavMenu({
  links,
  action,
}: {
  readonly links: readonly Link[];
  readonly action: Link;
}) {
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const root = document.documentElement;
    const overflow = root.style.overflow;
    root.style.overflow = 'hidden';
    menu.current?.querySelector<HTMLElement>('.menu-panel a')?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        button.current?.focus();
      }
      if (event.key !== 'Tab' || !menu.current) return;
      // Tab goes round the menu, not out to the page behind it.
      const items = Array.from(menu.current.querySelectorAll<HTMLElement>('button, a'));
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      root.style.overflow = overflow;
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="menu" ref={menu} data-open={open || undefined}>
      <button
        ref={button}
        type="button"
        className="menu-button"
        aria-label="Menu"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(!open)}
      >
        <span className="menu-icon" aria-hidden="true" />
      </button>
      <nav id={panelId} className="menu-panel" aria-label="Sections">
        <ol className="menu-links">
          {links.map((link, index) => (
            <li key={link.href} style={{ '--i': index } as CSSProperties}>
              <a href={link.href} onClick={() => setOpen(false)}>
                <span className="menu-index" aria-hidden="true">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <span className="menu-text">{link.label}</span>
                <svg className="menu-arrow" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M5 12h13M13 6l6 6-6 6" />
                </svg>
              </a>
            </li>
          ))}
        </ol>
        <a className="button small menu-action" href={action.href} onClick={() => setOpen(false)}>
          {action.label}
        </a>
        <p className="menu-foot">Open source · MIT · by Boldare</p>
      </nav>
    </div>
  );
}
