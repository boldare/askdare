import type { ResponseFileSearchToolCall } from 'openai/resources/responses/responses';

const MAX_TITLE = 200;
const MAX_URL = 512;

/** Title and URL per file ID, from the attributes `chatdock kb sync` stores with each file. */
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
