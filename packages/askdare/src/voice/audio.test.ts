import { describe, expect, it } from 'vitest';
import { detectAudio, languageHints, maxAudioBytes, worstCaseSeconds } from './audio';

const bytes = (...parts: (string | number[])[]): Uint8Array =>
  new Uint8Array(
    parts.flatMap((part) =>
      typeof part === 'string' ? Array.from(part, (char) => char.charCodeAt(0)) : part,
    ),
  );

describe('detectAudio', () => {
  it.each([
    [
      'WebM (Chrome, Firefox)',
      bytes([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x82, 0x84], 'webm'),
      'webm',
    ],
    ['MP4 (Safari)', bytes([0, 0, 0, 0x1c], 'ftypiso5'), 'mp4'],
    ['WAV', bytes('RIFF', [0, 0, 0, 0], 'WAVEfmt '), 'wav'],
    ['MP3 with ID3', bytes('ID3', [4, 0]), 'mp3'],
    ['MP3 frame', bytes([0xff, 0xfb, 0x90]), 'mp3'],
  ])('recognizes %s', (_name, input, extension) => {
    expect(detectAudio(input)?.extension).toBe(extension);
  });

  it.each([
    ['Ogg', bytes('OggS', [0, 2])],
    ['Matroska', bytes([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x82, 0x88], 'matroska')],
    ['JPEG', bytes([0xff, 0xd8, 0xff, 0xe0])],
    ['text', bytes('hello')],
  ])('refuses %s', (_name, input) => {
    expect(detectAudio(input)).toBeUndefined();
  });
});

describe('language hints', () => {
  it('keeps up to three distinct ISO 639-1 codes', () => {
    expect(languageHints('pl-PL, pl, en-US, de, fr')).toEqual(['pl', 'en', 'de']);
    expect(languageHints('zh-Hant,<script>,english,x')).toEqual(['zh']);
    expect(languageHints(null)).toEqual([]);
  });

  it('allows 128 kbps for the longest dictation', () => {
    expect(maxAudioBytes(60)).toBe(60 * 16_000 + 32_000);
  });

  it('assumes the lowest speech bitrate when the billed duration is unknown', () => {
    expect(worstCaseSeconds(240_000, 60)).toBe(480);
    expect(worstCaseSeconds(1_000, 60)).toBe(60);
  });
});
