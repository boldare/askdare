/**
 * The model cites a passage of the bot's own index by writing its source ID in square brackets,
 * `[k0123456789ab]` or `[k0123456789ab, k89abcdef0123]` (ADR-0025, decision 5). These helpers find
 * those markers and rewrite them into the protocol's `[n]` markers, live and on reload.
 */

/** One source ID: `k` and 12 hex characters (`sourceIdOf`). */
const ID = 'k[0-9a-f]{12}';
/** A complete marker of one or more IDs. */
const MARKER = new RegExp(`\\[[ \\t]*(${ID}(?:[ \\t]*[,;][ \\t]*${ID})*)[ \\t]*\\]`, 'gi');
/** What could still grow into a marker: an open `[` followed by a prefix of the grammar above. */
const PARTIAL =
  /\[[ \t]*(?:k[0-9a-f]{0,12}(?:[ \t]*[,;][ \t]*k[0-9a-f]{0,12})*[ \t]*[,;]?[ \t]*)?$/i;
/** Longest text held back while a marker may still be open. */
export const MARKER_HOLD_LIMIT = 48;

/** The source IDs of one marker's content, lowercase, in the order written. */
const idsOf = (content: string): string[] =>
  content.split(/[ \t]*[,;][ \t]*/).map((id) => id.trim().toLowerCase());

/** Every source ID the text cites, each once, in order of first appearance. */
export function citedSourceIds(text: string): string[] {
  const ids = new Set<string>();
  for (const match of text.matchAll(MARKER)) {
    for (const id of idsOf(match[1] ?? '')) ids.add(id);
  }
  return [...ids];
}

/**
 * Rewrites every marker with `number`, which gives a source ID's `[n]` or undefined to drop it.
 * IDs of one marker that share a number are written once; a marker with no known ID disappears.
 */
export function rewriteMarkers(text: string, number: (id: string) => number | undefined): string {
  return text.replace(MARKER, (_marker: string, content: string) => {
    const numbers: number[] = [];
    for (const id of idsOf(content)) {
      const n = number(id);
      if (n !== undefined && !numbers.includes(n)) numbers.push(n);
    }
    return numbers.map((n) => `[${n}]`).join('');
  });
}

/**
 * `rewriteMarkers` for streamed text, with an asynchronous lookup (a passage of an earlier turn is
 * read from the index). Text from an unclosed `[` that could still become a marker is held back,
 * at most {@link MARKER_HOLD_LIMIT} characters, so a marker split across deltas is still rewritten.
 * Other brackets and Markdown links pass straight through.
 */
export class MarkerRewriter {
  readonly #resolve: (ids: readonly string[]) => Promise<(id: string) => number | undefined>;
  #held = '';

  /** `resolve` looks up a batch of IDs and returns their numbers, registering new sources. */
  constructor(resolve: (ids: readonly string[]) => Promise<(id: string) => number | undefined>) {
    this.#resolve = resolve;
  }

  /** Takes the next delta and resolves to the text that can be sent now (possibly empty). */
  async push(delta: string): Promise<string> {
    const text = this.#held + delta;
    const open = text.lastIndexOf('[');
    let end = text.length;
    if (open !== -1 && text.length - open < MARKER_HOLD_LIMIT && PARTIAL.test(text.slice(open))) {
      end = open;
    }
    this.#held = text.slice(end);
    return this.#rewrite(text.slice(0, end));
  }

  /** Resolves to the held text, rewritten, at the end of the step. */
  async flush(): Promise<string> {
    const held = this.#held;
    this.#held = '';
    return this.#rewrite(held);
  }

  async #rewrite(text: string): Promise<string> {
    const ids = citedSourceIds(text);
    if (ids.length === 0) return text;
    return rewriteMarkers(text, await this.#resolve(ids));
  }
}
