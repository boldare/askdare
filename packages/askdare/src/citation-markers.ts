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
