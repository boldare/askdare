'use client';

import { type ComponentProps, useRef, useState } from 'react';

/** A highlighted code block with a button that copies its text. */
export function CodeBlock(props: ComponentProps<'pre'>) {
  const pre = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    const text = pre.current?.textContent ?? '';
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // No clipboard access (an insecure page or a denied permission): the text stays selectable.
    }
  };
  return (
    <div className="code">
      {/* Focusable, so keyboard users can scroll long lines. */}
      {/* biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region must be reachable by keyboard */}
      <pre ref={pre} tabIndex={0} {...props} />
      <button type="button" className="copy" onClick={copy} aria-label="Copy code">
        <span aria-live="polite">{copied ? 'Copied' : 'Copy'}</span>
      </button>
    </div>
  );
}
