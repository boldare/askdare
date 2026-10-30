'use client';

import { useEffect, useId, useRef, useState } from 'react';

interface Link {
  readonly href: string;
  readonly label: string;
}

/**
 * The page's links and its main action. Wide screens show them in the bar; phones get a menu
 * button that opens them in a panel, closed again by a link, Escape or a click outside.
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
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    const onPointer = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open]);

  return (
    <div className="menu" ref={menu} data-open={open || undefined}>
      <button
        type="button"
        className="menu-button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(!open)}
      >
        <span className="menu-icon" aria-hidden="true" />
        <span className="menu-label">Menu</span>
      </button>
      <nav id={panelId} className="menu-panel" aria-label="Sections">
        {links.map((link) => (
          <a key={link.href} href={link.href} onClick={() => setOpen(false)}>
            {link.label}
          </a>
        ))}
        <a className="button small" href={action.href} onClick={() => setOpen(false)}>
          {action.label}
        </a>
      </nav>
    </div>
  );
}
