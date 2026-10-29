// biome-ignore-all lint/suspicious/noArrayIndexKey: a token's place in a fixed text is its identity; streaming only appends
import { Lexer, type Token, type Tokens } from 'marked';
import { Component, memo, type ReactNode } from 'react';

const SAFE_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);
/**
 * Deeper nesting than any real answer needs. Past it, the rest shows as plain text: a prompt-
 * injected answer of `>>>>…` or `- - - …` must not blow the stack and take the chat down with it.
 */
const MAX_DEPTH = 16;

/** Keeps only http(s) and mailto links; everything else (javascript:, data:, relative) is dropped. */
export function safeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return SAFE_PROTOCOLS.has(parsed.protocol) ? parsed.href : '';
  } catch {
    return '';
  }
}

const NAMED: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  copy: '©',
  reg: '®',
  trade: '™',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  laquo: '«',
  raquo: '»',
  bull: '•',
  middot: '·',
  deg: '°',
  plusmn: '±',
  times: '×',
  divide: '÷',
  euro: '€',
  pound: '£',
  yen: '¥',
  cent: '¢',
  sect: '§',
  para: '¶',
};

/**
 * marked leaves character references for an HTML renderer to decode; we render text, so decode
 * them here: numeric ones and the common named ones (others stay as written). Safe, because the
 * result is only ever text or a URL that `safeUrl` checks after decoding.
 */
export function decodeEntities(text: string): string {
  if (!text.includes('&')) return text;
  return text.replace(
    /&(#\d{1,7}|#[xX][\da-fA-F]{1,6}|[a-zA-Z]{2,8});/g,
    (match, entity: string) => {
      if (entity[0] !== '#') return NAMED[entity] ?? match;
      const code =
        entity[1] === 'x' || entity[1] === 'X'
          ? Number.parseInt(entity.slice(2), 16)
          : Number.parseInt(entity.slice(1), 10);
      // Like browsers: no NUL, surrogates or code points past Unicode.
      return code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff)
        ? String.fromCodePoint(code)
        : '�';
    },
  );
}

/** Inline tokens: text, emphasis, code, links. HTML is dropped, images are never loaded. */
function inline(tokens: readonly Token[] | undefined, depth: number): ReactNode[] {
  if (depth > MAX_DEPTH) return [(tokens ?? []).map((token) => token.raw).join('')];
  return (tokens ?? []).map((token, key) => {
    switch (token.type) {
      case 'text':
        return 'tokens' in token && token.tokens
          ? inline(token.tokens, depth + 1)
          : decodeEntities(token.text);
      case 'escape':
        return token.text;
      case 'strong':
        return <strong key={key}>{inline(token.tokens, depth + 1)}</strong>;
      case 'em':
        return <em key={key}>{inline(token.tokens, depth + 1)}</em>;
      case 'del':
        return <del key={key}>{inline(token.tokens, depth + 1)}</del>;
      case 'codespan':
        // Character references stay literal in code, as CommonMark says.
        return <code key={key}>{token.text}</code>;
      case 'br':
        return <br key={key} />;
      case 'link': {
        const href = safeUrl(decodeEntities(token.href));
        return href ? (
          <a key={key} href={href} target="_blank" rel="noopener noreferrer nofollow">
            {inline(token.tokens, depth + 1)}
          </a>
        ) : (
          <span key={key}>{inline(token.tokens, depth + 1)}</span>
        );
      }
      // Model output must never trigger requests: an image URL could carry data out (prompt injection).
      case 'image':
        return token.text ? (
          <span key={key} data-cd-part="image-alt">
            [{decodeEntities(token.text)}]
          </span>
        ) : null;
      default:
        // `html` and anything a later version of marked adds.
        return null;
    }
  });
}

function cells(row: readonly Tokens.TableCell[], header: boolean, depth: number): ReactNode[] {
  return row.map((cell, key) => {
    const Cell = header ? 'th' : 'td';
    return (
      <Cell key={key} style={cell.align ? { textAlign: cell.align } : undefined}>
        {inline(cell.tokens, depth + 1)}
      </Cell>
    );
  });
}

function blocks(tokens: readonly Token[], depth: number): ReactNode[] {
  if (depth > MAX_DEPTH) return [tokens.map((token) => token.raw).join('')];
  return tokens.map((token, key) => {
    switch (token.type) {
      case 'paragraph':
        return <p key={key}>{inline(token.tokens, depth + 1)}</p>;
      case 'text':
        // Text directly in a tight list item.
        return token.tokens ? inline(token.tokens, depth + 1) : decodeEntities(token.text);
      case 'heading': {
        const Heading = `h${Math.min(Math.max(token.depth, 1), 6)}` as 'h1';
        return <Heading key={key}>{inline(token.tokens, depth + 1)}</Heading>;
      }
      case 'code':
        return (
          <pre key={key}>
            <code>{token.text}</code>
          </pre>
        );
      case 'blockquote':
        return <blockquote key={key}>{blocks(token.tokens ?? [], depth + 1)}</blockquote>;
      case 'hr':
        return <hr key={key} />;
      case 'list': {
        const items = token.items.map((item: Tokens.ListItem, index: number) => (
          <li key={index}>
            {item.task && <input type="checkbox" checked={item.checked ?? false} disabled />}
            {blocks(
              item.tokens.filter((child) => child.type !== 'checkbox'),
              depth + 1,
            )}
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
              <tr>{cells(token.header, true, depth)}</tr>
            </thead>
            <tbody>
              {token.rows.map((row: Tokens.TableCell[], index: number) => (
                <tr key={index}>{cells(row, false, depth)}</tr>
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

/** The text as paragraphs, when markdown can't be had. */
const plain = (text: string): ReactNode =>
  text.split(/\n{2,}/).map((paragraph, key) => <p key={key}>{paragraph}</p>);

function render(text: string): ReactNode {
  try {
    return blocks(Lexer.lex(text, { gfm: true }), 0);
  } catch {
    // A pathological input, such as nesting deep enough to exhaust marked's stack.
    return plain(text);
  }
}

/** Shows the plain text if rendering a message ever fails, so one answer can't break the chat. */
class Fallback extends Component<{ readonly text: string; readonly children: ReactNode }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override render(): ReactNode {
    return this.state.failed ? plain(this.props.text) : this.props.children;
  }
}

/**
 * Renders model output as markdown (GFM) without ever producing raw HTML: marked only tokenizes,
 * and each token becomes an element here. HTML in the source is dropped, links are limited to
 * http(s)/mailto and open in a new tab, and images are never loaded (ADR-0004).
 */
export const Markdown = memo(function Markdown({ text }: { readonly text: string }) {
  return <Fallback text={text}>{render(text)}</Fallback>;
});
