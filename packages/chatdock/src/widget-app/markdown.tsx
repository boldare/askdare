import { memo } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

const SAFE_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

/** Keeps only http(s) and mailto links; everything else (javascript:, data:, relative) is dropped. */
export function safeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return SAFE_PROTOCOLS.has(parsed.protocol) ? parsed.href : '';
  } catch {
    return '';
  }
}

const components: Components = {
  a: ({ href, children }) =>
    href ? (
      <a href={href} target="_blank" rel="noopener noreferrer nofollow">
        {children}
      </a>
    ) : (
      <span>{children}</span>
    ),
  // Model output must never trigger requests: an image URL could carry data out (prompt injection).
  img: ({ alt }) => (alt ? <span data-cd-part="image-alt">[{alt}]</span> : null),
};

/**
 * Renders model output as markdown without ever producing raw HTML: HTML in the source is dropped,
 * links are limited to http(s)/mailto and open in a new tab, and images are never loaded (ADR-0004).
 */
export const Markdown = memo(function Markdown({ text }: { readonly text: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      skipHtml
      urlTransform={safeUrl}
      components={components}
    >
      {text}
    </ReactMarkdown>
  );
});
