/**
 * Heading-aware chunking (ADR-0025, decision 1). A chunk never crosses a heading, carries its
 * heading trail, and keeps a table, list or code block whole when it fits. Sizes are estimated
 * tokens (characters / 4): far under any embedding model's input limit, and small enough that
 * search results stay small in the model's context.
 */

/** The default and the ADR's "about 350 tokens". */
export const MAX_CHUNK_TOKENS = 350;
const CHARS_PER_TOKEN = 4;
/** Below this many characters left for content, a repeated table header or code fence is dropped. */
const MIN_FRAMED_BODY = 120;

export interface TextChunk {
  /** Heading trail joined with " › "; undefined before the first heading. */
  readonly section: string | undefined;
  readonly text: string;
}

export interface ChunkOptions {
  readonly maxTokens?: number;
}

type Block =
  | { readonly kind: 'heading'; readonly level: number; readonly title: string }
  | { readonly kind: 'text'; readonly lines: readonly string[]; readonly fenced: boolean };

const ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const SETEXT = /^ {0,3}(=+|-+)[ \t]*$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const TABLE_SEPARATOR = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

/** Markdown-ish text into headings and blocks separated by blank lines; fenced code stays one block. */
function blocks(text: string): Block[] {
  const result: Block[] = [];
  let lines: string[] = [];
  let fence: string | undefined;
  let fenced = false;
  const end = (): void => {
    if (lines.some((line) => line.trim() !== '')) result.push({ kind: 'text', lines, fenced });
    lines = [];
    fenced = false;
  };
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    if (fence !== undefined) {
      lines.push(line);
      const marker = FENCE.exec(line)?.[1];
      if (
        marker !== undefined &&
        marker[0] === fence[0] &&
        marker.length >= fence.length &&
        line.trim() === marker
      ) {
        fence = undefined;
        end();
      }
      continue;
    }
    const opening = FENCE.exec(line)?.[1];
    if (opening !== undefined) {
      end();
      fence = opening;
      fenced = true;
      lines.push(line);
      continue;
    }
    if (line.trim() === '') {
      end();
      continue;
    }
    const atx = ATX.exec(line);
    if (atx?.[1]) {
      end();
      result.push({ kind: 'heading', level: atx[1].length, title: (atx[2] ?? '').trim() });
      continue;
    }
    const setext = SETEXT.exec(line)?.[1];
    if (setext !== undefined) {
      const [only] = lines;
      if (lines.length === 1 && only !== undefined && !/^\s*([-*+|>]|\d+[.)])/.test(only)) {
        lines = [];
        result.push({ kind: 'heading', level: setext[0] === '=' ? 1 : 2, title: only.trim() });
      } else if (lines.length === 0) {
        // A thematic break: nothing to keep.
      } else lines.push(line);
      continue;
    }
    lines.push(line);
  }
  end();
  return result;
}

/** Greedy packing of pieces, each at most `max` characters, into strings joined by `separator`. */
function pack(pieces: readonly string[], separator: string, max: number): string[] {
  const packed: string[] = [];
  let current = '';
  for (const piece of pieces) {
    if (current !== '' && current.length + separator.length + piece.length > max) {
      packed.push(current);
      current = '';
    }
    current = current === '' ? piece : `${current}${separator}${piece}`;
  }
  if (current !== '') packed.push(current);
  return packed;
}

/** One line longer than `max`: by sentences, then words, then hard cuts. */
function splitLine(line: string, max: number): string[] {
  if (line.length <= max) return [line];
  const sentences = line.split(/(?<=[.!?…])\s+/);
  if (sentences.length > 1)
    return pack(
      sentences.flatMap((part) => splitLine(part, max)),
      ' ',
      max,
    );
  const words = line.split(/\s+/);
  if (words.length > 1)
    return pack(
      words.flatMap((part) => splitLine(part, max)),
      ' ',
      max,
    );
  const cuts: string[] = [];
  for (let start = 0; start < line.length; start += max) cuts.push(line.slice(start, start + max));
  return cuts;
}

/**
 * A block longer than `max`, by lines. A table repeats its header row in every piece and a fenced
 * code block its fences, so each piece still reads as what it is.
 */
function splitBlock(block: Extract<Block, { kind: 'text' }>, max: number): string[] {
  const { lines } = block;
  let head: readonly string[] = [];
  let tail: readonly string[] = [];
  let body: readonly string[] = lines;
  const [first, second] = lines;
  if (block.fenced && first !== undefined) {
    const closed = lines.length > 1 && FENCE.test(lines.at(-1) ?? '');
    head = [first];
    tail = closed ? lines.slice(-1) : [];
    body = lines.slice(1, closed ? -1 : undefined);
  } else if (first?.includes('|') && second !== undefined && TABLE_SEPARATOR.test(second)) {
    head = [first, second];
    body = lines.slice(2);
  }
  const frame = [...head, ...tail].join('\n').length + 2;
  if (max - frame < MIN_FRAMED_BODY) {
    head = [];
    tail = [];
    body = lines;
  }
  const room = head.length + tail.length > 0 ? max - frame : max;
  return pack(
    body.flatMap((line) => splitLine(line, room)),
    '\n',
    room,
  ).map((piece) => [...head, piece, ...tail].join('\n'));
}

/** Splits extracted text into chunks, each within one section. Deterministic: same text, same chunks. */
export function chunkText(text: string, options: ChunkOptions = {}): TextChunk[] {
  const max = Math.max(1, options.maxTokens ?? MAX_CHUNK_TOKENS) * CHARS_PER_TOKEN;
  const chunks: TextChunk[] = [];
  const trail: (string | undefined)[] = [];
  let section: string | undefined;
  let pieces: string[] = [];
  const flush = (): void => {
    for (const piece of pack(pieces, '\n\n', max)) chunks.push({ section, text: piece });
    pieces = [];
  };
  for (const block of blocks(text)) {
    if (block.kind === 'heading') {
      flush();
      trail.length = block.level - 1;
      trail[block.level - 1] = block.title || undefined;
      const named = trail.filter((title): title is string => title !== undefined);
      section = named.length > 0 ? named.join(' › ') : undefined;
      continue;
    }
    const joined = block.lines.join('\n').trim();
    if (joined.length <= max) pieces.push(block.fenced ? block.lines.join('\n') : joined);
    else pieces.push(...splitBlock(block, max));
  }
  flush();
  return chunks;
}
