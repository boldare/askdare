// biome-ignore-all lint/suspicious/noArrayIndexKey: a token's place in a fixed text is its identity; streaming only appends
import { Lexer, type Token, type Tokens } from 'marked';
import { Component, memo, type NamedExoticComponent, type ReactNode, useRef } from 'react';

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
          <span key={key} data-ask-part="image-alt">
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
  return tokens.map((token, key) => block(token, key, depth));
}

function block(token: Token, key: number, depth: number): ReactNode {
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
}

/** The text as paragraphs, when markdown can't be had. */
const plain = (text: string): ReactNode =>
  text.split(/\n{2,}/).map((paragraph, key) => <p key={key}>{paragraph}</p>);

/** What the last render lexed, so the next delta only re-lexes the end of the answer. */
interface Lexed {
  readonly text: string;
  readonly tokens: readonly Token[];
  /** Whether it can be extended: its tokens' sources add up to the text and it has no link definitions. */
  readonly extensible: boolean;
}

function lexAll(text: string): Lexed {
  const tokens = Lexer.lex(text, { gfm: true });
  const extensible =
    Object.keys(tokens.links).length === 0 &&
    tokens.reduce((length, token) => length + token.raw.length, 0) === text.length;
  return { text, tokens, extensible };
}

/**
 * Lexes `text`, reusing the tokens of `previous` when `text` only appends to it (a stream). Blocks
 * before the last one are finished: text appended after a block can't change it, with two
 * exceptions that stay on a full lex. A setext underline or a lazy continuation only reaches back
 * to the last block, which is re-lexed; a link definition applies to the whole text, so an answer
 * with one is lexed whole every time. Kept tokens stay the same objects, so their memoized
 * `Block`s don't re-render.
 */
function lex(text: string, previous: Lexed | undefined): Lexed {
  if (!previous?.extensible || !text.startsWith(previous.text)) return lexAll(text);
  const { tokens } = previous;
  let last = tokens.length - 1;
  while (last > 0 && tokens[last]?.type === 'space') last--;
  // Then back to a block that nothing appended can reopen: one closed by a blank line, and not a
  // list or indented code, which go on past blank lines.
  let blank = false;
  while (last > 0) {
    const before = tokens[last - 1] as Token;
    if (before.type === 'space') {
      blank = true;
    } else if (
      before.type !== 'list' &&
      !(before.type === 'code' && before.codeBlockStyle === 'indented') &&
      (blank || before.raw.endsWith('\n\n'))
    ) {
      break;
    } else {
      blank = false;
    }
    last--;
  }
  let offset = 0;
  for (let index = 0; index < last; index++) offset += tokens[index]?.raw.length ?? 0;
  const tail = lexAll(text.slice(offset));
  // A new link definition changes earlier blocks too.
  if (!tail.extensible) return lexAll(text);
  return {
    text,
    tokens: [...tokens.slice(0, Math.max(last, 0)), ...tail.tokens],
    extensible: true,
  };
}

/** One top-level block. Memoized: while an answer streams, only its last block re-renders. */
const Block = memo(function Block({ token }: { readonly token: Token }): ReactNode {
  try {
    return block(token, 0, 0);
  } catch {
    return plain(token.raw);
  }
});

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
export interface MarkdownProps {
  /** Model output, as streamed. */
  readonly text: string;
}

export const Markdown: NamedExoticComponent<MarkdownProps> = /* @__PURE__ */ memo(
  function Markdown({ text }: MarkdownProps) {
    // A cache, not state: whatever it holds is right for its own text, so a render React throws
    // away can't make it wrong.
    const lexed = useRef<Lexed | undefined>(undefined);
    let content: ReactNode;
    try {
      lexed.current = lex(text, lexed.current);
      content = lexed.current.tokens.map((token, key) => <Block key={key} token={token} />);
    } catch {
      // A pathological input, such as nesting deep enough to exhaust marked's stack.
      lexed.current = undefined;
      content = plain(text);
    }
    return <Fallback text={text}>{content}</Fallback>;
  },
);
