import type { StoredCitation } from '../conversations/port';
import { citedSourceIds } from './markers';
import type { KnowledgeIndex, Passage } from './port';

/**
 * Index lookups one turn (or one history read) makes for IDs its searches didn't return. A model
 * that writes many made-up IDs costs a bounded number of queries; further IDs are dropped.
 */
export const MAX_PASSAGE_LOOKUPS = 32;

/** Lookups in flight at once. */
const PARALLEL_LOOKUPS = 8;

/** A source ID as `sourceIdOf` writes it; anything else is never looked up. */
const SOURCE_ID = /^k[0-9a-f]{12}$/;

/** Http(s) only, as for file citations: the one link a citation may carry to the client. */
const httpUrl = (value: string | undefined): string | undefined =>
  value !== undefined && value.length <= 512 && /^https?:\/\/\S+$/i.test(value) ? value : undefined;

/** How a passage is cited: its document's title and link, never its text. */
export function passageCitation(passage: Passage): StoredCitation {
  const title = passage.title.trim().slice(0, 200) || 'Document';
  const url = httpUrl(passage.url);
  return url ? { title, url, sourceId: passage.sourceId } : { title, sourceId: passage.sourceId };
}

/**
 * What one source is to the visitor: a page with the same link, or else the same title, shows once.
 * Two chunks of one page, or two pages a visitor couldn't tell apart, share one `[n]`.
 */
export function citationKey(citation: StoredCitation): string {
  return citation.url !== undefined ? `url:${citation.url}` : `title:${citation.title}`;
}

/**
 * The passages one turn can cite: those its searches returned, then any other ID looked up once
 * through `passage()`, so a citation of an earlier turn's passage resolves (ADR-0025, decision 5).
 * IDs that don't resolve are dropped and counted; their text is never logged.
 */
export class PassageLookup {
  readonly #index: KnowledgeIndex;
  readonly #maxLookups: number;
  readonly #found = new Map<string, Passage | undefined>();
  #lookups = 0;
  /** Citations dropped because their ID resolved to nothing. */
  unknown = 0;

  constructor(index: KnowledgeIndex, maxLookups: number = MAX_PASSAGE_LOOKUPS) {
    this.#index = index;
    this.#maxLookups = maxLookups;
  }

  /** Remembers passages a search returned. */
  add(passages: readonly Passage[]): void {
    for (const passage of passages) this.#found.set(passage.sourceId, passage);
  }

  /** A passage already known to this turn. */
  get(sourceId: string): Passage | undefined {
    return this.#found.get(sourceId);
  }

  /**
   * Looks up the IDs not known yet, a few at a time so one turn can't take every connection of a
   * pool. A failed lookup counts as not found.
   */
  async resolve(ids: readonly string[], signal?: AbortSignal): Promise<void> {
    const missing: string[] = [];
    for (const id of new Set(ids)) {
      if (this.#found.has(id)) continue;
      if (!SOURCE_ID.test(id) || this.#lookups >= this.#maxLookups) {
        this.#found.set(id, undefined);
        continue;
      }
      this.#lookups += 1;
      missing.push(id);
    }
    for (let start = 0; start < missing.length; start += PARALLEL_LOOKUPS) {
      await Promise.all(
        missing.slice(start, start + PARALLEL_LOOKUPS).map((id) => this.#lookup(id, signal)),
      );
    }
  }

  async #lookup(id: string, signal: AbortSignal | undefined): Promise<void> {
    try {
      const passage = await this.#index.passage(id, signal ? { signal } : {});
      // An index must answer for the ID asked; anything else is not this citation.
      this.#found.set(id, passage?.sourceId === id ? passage : undefined);
    } catch (error) {
      if (signal?.aborted) throw error;
      this.#found.set(id, undefined);
      console.error('[askdare] a cited knowledge passage could not be read; it is dropped.');
    }
  }

  /** The citations of the IDs a text cites that resolved, in order, as stored with the text. */
  citationsOf(text: string): StoredCitation[] {
    return citedSourceIds(text).flatMap((id) => {
      const passage = this.#found.get(id);
      return passage ? [passageCitation(passage)] : [];
    });
  }
}
