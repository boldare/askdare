// biome-ignore-all lint/suspicious/noArrayIndexKey: a token's place in a fixed text is its identity; streaming only appends
import { Lexer, type Token, type Tokens } from 'marked';
import { memo, type ReactNode } from 'react';

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

/** Inline tokens: text, emphasis, code, links. HTML is dropped, images are never loaded. */
function inline(tokens: readonly Token[] | undefined): ReactNode[] {
  return (tokens ?? []).map((token, key) => {
    switch (token.type) {
      case 'text':
        return 'tokens' in token && token.tokens ? inline(token.tokens) : token.text;
      case 'escape':
        return token.text;
      case 'strong':
        return <strong key={key}>{inline(token.tokens)}</strong>;
      case 'em':
        return <em key={key}>{inline(token.tokens)}</em>;
      case 'del':
        return <del key={key}>{inline(token.tokens)}</del>;
      case 'codespan':
        return <code key={key}>{token.text}</code>;
      case 'br':
        return <br key={key} />;
      case 'link': {
        const href = safeUrl(token.href);
        return href ? (
          <a key={key} href={href} target="_blank" rel="noopener noreferrer nofollow">
            {inline(token.tokens)}
          </a>
        ) : (
          <span key={key}>{inline(token.tokens)}</span>
        );
      }
      // Model output must never trigger requests: an image URL could carry data out (prompt injection).
      case 'image':
        return token.text ? (
          <span key={key} data-cd-part="image-alt">
            [{token.text}]
          </span>
        ) : null;
      default:
        // `html` and anything a later version of marked adds.
        return null;
    }
  });
}

function cells(row: readonly Tokens.TableCell[], header: boolean): ReactNode[] {
  return row.map((cell, key) => {
    const Cell = header ? 'th' : 'td';
    return (
      <Cell key={key} style={cell.align ? { textAlign: cell.align } : undefined}>
        {inline(cell.tokens)}
      </Cell>
    );
  });
}

function blocks(tokens: readonly Token[]): ReactNode[] {
  return tokens.map((token, key) => {
    switch (token.type) {
      case 'paragraph':
        return <p key={key}>{inline(token.tokens)}</p>;
      case 'text':
        // Text directly in a tight list item.
        return token.tokens ? inline(token.tokens) : token.text;
      case 'heading': {
        const Heading = `h${Math.min(Math.max(token.depth, 1), 6)}` as 'h1';
        return <Heading key={key}>{inline(token.tokens)}</Heading>;
      }
      case 'code':
        return (
          <pre key={key}>
            <code>{token.text}</code>
          </pre>
        );
      case 'blockquote':
        return <blockquote key={key}>{blocks(token.tokens ?? [])}</blockquote>;
      case 'hr':
        return <hr key={key} />;
      case 'list': {
        const items = token.items.map((item: Tokens.ListItem, index: number) => (
          <li key={index}>
            {item.task && <input type="checkbox" checked={item.checked ?? false} disabled />}
            {blocks(item.tokens.filter((child) => child.type !== 'checkbox'))}
          </li>
        ));
        return token.ordered ? (
          <ol key={key} start={typeof token.start === 'number' ? token.start : undefined}>
            {items}
          </ol>
        ) : (
          <ul key={key}>{items}</ul>
        );
      }
      case 'table':
        return (
          <table key={key}>
            <thead>
              <tr>{cells(token.header, true)}</tr>
            </thead>
            <tbody>
              {token.rows.map((row: Tokens.TableCell[], index: number) => (
                <tr key={index}>{cells(row, false)}</tr>
              ))}
            </tbody>
          </table>
        );
      default:
        // `html`, `space`, link definitions and anything a later version adds.
        return null;
    }
  });
}

/**
 * Renders model output as markdown (GFM) without ever producing raw HTML: marked only tokenizes,
 * and each token becomes an element here. HTML in the source is dropped, links are limited to
 * http(s)/mailto and open in a new tab, and images are never loaded (ADR-0004).
 */
export const Markdown = memo(function Markdown({ text }: { readonly text: string }) {
  return <>{blocks(Lexer.lex(text, { gfm: true }))}</>;
});
