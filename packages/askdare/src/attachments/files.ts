export type AttachmentKind = 'image' | 'pdf';

export interface DetectedFile {
  readonly kind: AttachmentKind;
  readonly mime: string;
  readonly extension: string;
}

const MAX_NAME = 80;

const ascii = (text: string): number[] => Array.from(text, (char) => char.charCodeAt(0));

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

function count(bytes: Uint8Array, pattern: readonly number[]): number {
  let found = 0;
  for (let index = 0; index <= bytes.length - pattern.length; index += 1) {
    if (startsWith(bytes, pattern, index)) found += 1;
  }
  return found;
}

/** Animated GIFs loop (NETSCAPE2.0) or have several frames, each with its own control block. */
const isAnimatedGif = (bytes: Uint8Array): boolean =>
  count(bytes, ascii('NETSCAPE2.0')) > 0 || count(bytes, [0x21, 0xf9, 0x04]) > 1;

/** Extended WebP (VP8X) carries an animation flag in its header. */
const isAnimatedWebp = (bytes: Uint8Array): boolean =>
  startsWith(bytes, ascii('VP8X'), 12) && ((bytes[20] ?? 0) & 0x02) !== 0;

/**
 * Detects the file type from its first bytes. The file name and Content-Type are never trusted.
 * Only types OpenAI accepts as model input pass: PNG, JPEG, WebP, GIF (not animated) and PDF.
 * Everything else, SVG included, is rejected.
 */
export function detectFile(bytes: Uint8Array): DetectedFile | undefined {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { kind: 'image', mime: 'image/png', extension: 'png' };
  }
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
    return { kind: 'image', mime: 'image/jpeg', extension: 'jpg' };
  }
  if (startsWith(bytes, ascii('GIF87a')) || startsWith(bytes, ascii('GIF89a'))) {
    return isAnimatedGif(bytes)
      ? undefined
      : { kind: 'image', mime: 'image/gif', extension: 'gif' };
  }
  if (startsWith(bytes, ascii('RIFF')) && startsWith(bytes, ascii('WEBP'), 8)) {
    return isAnimatedWebp(bytes)
      ? undefined
      : { kind: 'image', mime: 'image/webp', extension: 'webp' };
  }
  if (startsWith(bytes, ascii('%PDF-'))) {
    return { kind: 'pdf', mime: 'application/pdf', extension: 'pdf' };
  }
  return undefined;
}

/** Decompressed bytes scanned per PDF while counting pages, so a zip bomb can't exhaust memory. */
const INFLATE_BUDGET = 32 * 1024 * 1024;

const latin1 = (bytes: Uint8Array): string => new TextDecoder('latin1').decode(bytes);

/** PDF names may escape characters as #xx, so /P#61ge is /Page. */
const unescapeNames = (text: string): string =>
  text.replace(/#([0-9A-Fa-f]{2})/g, (_match, hex: string) =>
    String.fromCharCode(Number.parseInt(hex, 16)),
  );

function pageCounts(text: string): { readonly objects: number; readonly declared: number } {
  const clean = unescapeNames(text);
  let declared = 0;
  for (const match of clean.matchAll(/\/Count\s+(\d+)/g)) {
    declared = Math.max(declared, Number(match[1]));
  }
  return { objects: clean.match(/\/Type\s*\/Page(?![A-Za-z])/g)?.length ?? 0, declared };
}

async function inflate(
  data: Uint8Array,
  budget: { left: number },
): Promise<Uint8Array | undefined> {
  try {
    const reader = new Blob([data])
      .stream()
      .pipeThrough(new DecompressionStream('deflate'))
      .getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      budget.left -= value.byteLength;
      if (budget.left < 0) {
        await reader.cancel();
        return undefined;
      }
      chunks.push(value);
    }
    const out = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return out;
  } catch {
    return undefined;
  }
}

/**
 * Pages of a PDF: the larger of the page objects found and the page count the file declares,
 * including both inside compressed object streams. Returns `undefined` when the file hides its
 * structure (encryption, unknown filters, broken streams), so callers can assume the worst.
 */
export async function countPdfPages(bytes: Uint8Array): Promise<number | undefined> {
  const text = latin1(bytes);
  if (/\/Encrypt\b/.test(text)) return undefined;
  let { objects, declared } = pageCounts(text);
  const budget = { left: INFLATE_BUDGET };
  // `endstream` has no word boundary before `stream`, so this finds stream starts only.
  for (const match of text.matchAll(/\bstream(\r\n|\n|\r)/g)) {
    const start = match.index + match[0].length;
    const objectStart = Math.max(0, text.lastIndexOf(' obj', match.index));
    const dictionary = unescapeNames(text.slice(objectStart, match.index));
    if (!/\/Type\s*\/ObjStm\b/.test(dictionary)) continue;
    const filter = /\/Filter\s*(\[[^\]]*\]|\/[A-Za-z0-9]+)/.exec(dictionary)?.[1] ?? '';
    if (filter.replace(/[[\]\s]/g, '') !== '/FlateDecode' || /\/DecodeParms/.test(dictionary)) {
      return undefined;
    }
    const length = /\/Length\s+(\d+)(?!\s+\d+\s+R)/.exec(dictionary);
    const end = length ? start + Number(length[1]) : text.indexOf('endstream', start);
    if (end < start) return undefined;
    const inflated = await inflate(bytes.subarray(start, end), budget);
    if (!inflated) return undefined;
    const inner = pageCounts(latin1(inflated));
    objects += inner.objects;
    declared = Math.max(declared, inner.declared);
  }
  const pages = Math.max(objects, declared);
  return pages > 0 ? pages : undefined;
}

/** Input tokens one image adds to a turn (detail `auto`). */
export const IMAGE_TOKENS = 1_500;
/** Input tokens one PDF page adds: its extracted text plus a high-detail page image. */
export const PDF_PAGE_TOKENS = 2_000;

/**
 * A safe file name for OpenAI: the visitor's base name without paths or control characters, and
 * the extension of the detected type, which is what OpenAI reads the file as.
 */
export function attachmentName(raw: string | null, file: DetectedFile): string {
  let decoded = '';
  try {
    decoded = decodeURIComponent(raw ?? '');
  } catch {
    // Malformed encoding: fall back to the default name.
  }
  const base = (decoded.split(/[\\/]/).pop() ?? '')
    .replace(/\.[^.]*$/, '')
    .replace(/[^\p{L}\p{N} ._()-]+/gu, '_')
    .trim()
    .slice(0, MAX_NAME);
  return `${base || 'attachment'}.${file.extension}`;
}
