export type AttachmentKind = 'image' | 'pdf';

export interface DetectedFile {
  readonly kind: AttachmentKind;
  readonly mime: string;
  readonly extension: string;
}

/** Rough input cost of one image (detail `auto`) and of one PDF page (text plus page image). */
const IMAGE_TOKENS = 1_500;
const PDF_PAGE_TOKENS = 1_500;
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

/** Page objects when they are readable, otherwise about one page per 100 KB. */
export function estimatePdfPages(bytes: Uint8Array): number {
  const text = new TextDecoder('latin1').decode(bytes);
  const pages = text.match(/\/Type\s*\/Page(?![A-Za-z])/g)?.length ?? 0;
  return Math.max(1, pages || Math.ceil(bytes.byteLength / 100_000));
}

/** Input tokens a file adds to a turn, reserved against the budgets before the model runs. */
export function estimateAttachmentTokens(file: DetectedFile, bytes: Uint8Array): number {
  return file.kind === 'image' ? IMAGE_TOKENS : estimatePdfPages(bytes) * PDF_PAGE_TOKENS;
}

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
