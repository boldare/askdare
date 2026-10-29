export interface DetectedAudio {
  readonly mime: string;
  readonly extension: string;
}

/** Bytes allowed per second of speech: 128 kbps, the most browsers record (Safari's AAC default). */
const BYTES_PER_SECOND = 16_000;
/** About 4 kbps, the lowest bitrate speech codecs use, so the longest audio a file can hold. */
const MIN_BYTES_PER_SECOND = 500;

const ascii = (text: string): number[] => Array.from(text, (char) => char.charCodeAt(0));

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

function contains(bytes: Uint8Array, pattern: readonly number[], within: number): boolean {
  const end = Math.min(bytes.length, within) - pattern.length;
  for (let index = 0; index <= end; index += 1) {
    if (startsWith(bytes, pattern, index)) return true;
  }
  return false;
}

/**
 * Detects a recording's container from its first bytes, limited to what OpenAI transcribes and
 * browsers record: WebM (Chrome, Firefox, Edge), MP4 (Safari), plus WAV and MP3. Ogg and
 * Matroska are refused because OpenAI does not accept them.
 */
export function detectAudio(bytes: Uint8Array): DetectedAudio | undefined {
  if (startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3])) {
    return contains(bytes, ascii('webm'), 64)
      ? { mime: 'audio/webm', extension: 'webm' }
      : undefined;
  }
  if (startsWith(bytes, ascii('ftyp'), 4)) return { mime: 'audio/mp4', extension: 'mp4' };
  if (startsWith(bytes, ascii('RIFF')) && startsWith(bytes, ascii('WAVE'), 8)) {
    return { mime: 'audio/wav', extension: 'wav' };
  }
  if (
    startsWith(bytes, ascii('ID3')) ||
    ((bytes[0] ?? 0) === 0xff && ((bytes[1] ?? 0) & 0xe0) === 0xe0)
  ) {
    return { mime: 'audio/mpeg', extension: 'mp3' };
  }
  return undefined;
}

/** Largest recording accepted for a bot's longest allowed dictation. */
export const maxAudioBytes = (maxSeconds: number): number => maxSeconds * BYTES_PER_SECOND + 32_000;

/** Seconds to charge when the billed duration is unknown: the longest a file of this size can play. */
export const worstCaseSeconds = (bytes: number, maxSeconds: number): number =>
  Math.max(maxSeconds, Math.ceil(bytes / MIN_BYTES_PER_SECOND));

/** ISO 639-1 codes from the visitor's languages, as hints for transcription; at most three. */
export function languageHints(header: string | null): string[] {
  const codes = (header ?? '')
    .split(',')
    .map((code) => code.trim().toLowerCase().split('-')[0] ?? '')
    .filter((code) => /^[a-z]{2}$/.test(code));
  return [...new Set(codes)].slice(0, 3);
}
