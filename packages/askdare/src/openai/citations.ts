import type { ResponseFileSearchToolCall } from 'openai/resources/responses/responses';

const MAX_TITLE = 200;
const MAX_URL = 512;

/** Title and URL per file ID, from the attributes `askdare kb sync` stores with each file. */
export type KnowledgeSources = Map<
  string,
  { readonly title: string | undefined; readonly url: string | undefined }
>;

export interface CitationSource {
  /** Identity for de-duplication: files citing the same page collapse into one source. */
  readonly key: string;
  readonly title: string;
  readonly url: string | undefined;
}

const httpUrl = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length <= MAX_URL && /^https?:\/\/\S+$/i.test(value)
    ? value
    : undefined;

const label = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value.trim().slice(0, MAX_TITLE) : undefined;

/** Remembers how to cite each file a search returned (needs `include: file_search_call.results`). */
export function addSources(call: ResponseFileSearchToolCall, sources: KnowledgeSources): void {
  for (const result of call.results ?? []) {
    if (!result.file_id) continue;
    sources.set(result.file_id, {
      title: label(result.attributes?.['title']) ?? label(result.filename),
      url: httpUrl(result.attributes?.['url']),
    });
  }
}

/**
 * Turns a text annotation into a source to show. Only http(s) links pass; unknown annotation
 * types are ignored because the SDK adds them in minor releases.
 */
export function citationSource(
  annotation: unknown,
  sources: KnowledgeSources,
): CitationSource | undefined {
  if (typeof annotation !== 'object' || annotation === null || !('type' in annotation)) {
    return undefined;
  }
  if (annotation.type === 'url_citation' && 'url' in annotation) {
    const url = httpUrl(annotation.url);
    if (!url) return undefined;
    const title = 'title' in annotation ? label(annotation.title) : undefined;
    return { key: `url:${url}`, title: title ?? url, url };
  }
  if (
    annotation.type === 'file_citation' &&
    'file_id' in annotation &&
    typeof annotation.file_id === 'string'
  ) {
    const source = sources.get(annotation.file_id);
    const filename = 'filename' in annotation ? label(annotation.filename) : undefined;
    return {
      key: source?.url ? `url:${source.url}` : `file:${annotation.file_id}`,
      title: source?.title ?? filename ?? 'Document',
      url: source?.url,
    };
  }
  return undefined;
}

/** A citation marker repeated right after itself, with only spaces or tabs between. */
const REPEATED_MARKER = /\[(\d{1,3})\](?:[ \t]*\[\1\])+/g;
/** A marker at the end of the text, then what could still become its repeat. */
const OPEN_REPEAT = /(\[\d{1,3}\])([ \t]*(?:\[\d{0,3})?)$/;
/** The start of a marker cut off at the end of the text. */
const OPEN_MARKER = /\[\d{0,3}$/;

/**
 * Merges adjacent identical citation markers: `[1] [1]` and `[1][1]` become `[1]`. Only numbers
 * that `isCitation` accepts are merged, so text such as `grid[1][1]` in an answer without that
 * citation stays as written.
 */
export function mergeRepeatedMarkers(text: string, isCitation: (index: number) => boolean): string {
  return text.replace(REPEATED_MARKER, (repeat: string, index: string) =>
    isCitation(Number(index)) ? `[${index}]` : repeat,
  );
}

/**
 * `mergeRepeatedMarkers` for streamed text. Holds back what follows a marker (spaces, a partial
 * `[`) until the next delta shows whether it repeats the marker, so a repeat split across deltas
 * is still merged. At most a few characters wait; `flush` releases them at the end of the step.
 */
export class MarkerMerger {
  readonly #isCitation: (index: number) => boolean;
  /** The marker the text sent so far ends with, if it ends with one. */
  #marker = '';
  #held = '';

  constructor(isCitation: (index: number) => boolean) {
    this.#isCitation = isCitation;
  }

  /** Takes the next delta and returns the text that can be sent now (possibly empty). */
  push(delta: string): string {
    const sent = this.#marker.length;
    const text = mergeRepeatedMarkers(this.#marker + this.#held + delta, this.#isCitation);
    // Merging keeps the first marker of a run, so the text still starts with the sent marker.
    const repeat = OPEN_REPEAT.exec(text);
    const partial = repeat ? undefined : OPEN_MARKER.exec(text);
    const end = repeat ? text.length - (repeat[2] ?? '').length : (partial?.index ?? text.length);
    this.#marker = repeat?.[1] ?? '';
    this.#held = text.slice(end);
    return text.slice(sent, end);
  }

  /** Returns the held text, for the end of the stream. */
  flush(): string {
    const held = this.#held;
    this.#marker = '';
    this.#held = '';
    return held;
  }
}
