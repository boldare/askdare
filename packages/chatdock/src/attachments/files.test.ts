import { describe, expect, it } from 'vitest';
import { attachmentName, detectFile, estimateAttachmentTokens, estimatePdfPages } from './files';

const bytes = (...parts: (string | number[])[]): Uint8Array =>
  new Uint8Array(
    parts.flatMap((part) =>
      typeof part === 'string' ? Array.from(part, (char) => char.charCodeAt(0)) : part,
    ),
  );

describe('detectFile', () => {
  it.each([
    ['PNG', bytes([0x89], 'PNG', [0x0d, 0x0a, 0x1a, 0x0a, 0]), 'image/png'],
    ['JPEG', bytes([0xff, 0xd8, 0xff, 0xe0]), 'image/jpeg'],
    ['GIF', bytes('GIF89a', [1, 0, 1, 0, 0x21, 0xf9, 0x04, 0, 0x3b]), 'image/gif'],
    ['WebP', bytes('RIFF', [0, 0, 0, 0], 'WEBPVP8 '), 'image/webp'],
    ['PDF', bytes('%PDF-1.7\n'), 'application/pdf'],
  ])('recognizes %s by its bytes', (_name, input, mime) => {
    expect(detectFile(input)?.mime).toBe(mime);
  });

  it.each([
    ['SVG', bytes('<svg xmlns="http://www.w3.org/2000/svg"/>')],
    ['HTML', bytes('<!doctype html>')],
    ['empty', bytes()],
    ['animated GIF', bytes('GIF89a', [0x21, 0xff, 0x0b], 'NETSCAPE2.0')],
    ['multi-frame GIF', bytes('GIF89a', [0x21, 0xf9, 0x04, 0, 0x21, 0xf9, 0x04])],
    ['animated WebP', bytes('RIFF', [0, 0, 0, 0], 'WEBPVP8X', [0, 0, 0, 0, 0x02])],
  ])('rejects %s', (_name, input) => {
    expect(detectFile(input)).toBeUndefined();
  });
});

describe('estimates', () => {
  it('counts PDF page objects, and falls back to the file size', () => {
    expect(estimatePdfPages(bytes('%PDF /Type /Pages /Type /Page /Type/Page'))).toBe(2);
    expect(estimatePdfPages(new Uint8Array(250_000))).toBe(3);
  });

  it('reserves a fixed cost per image and per PDF page', () => {
    const pdf = bytes('%PDF-1.7 /Type /Page /Type /Page /Type /Page');
    const detected = detectFile(pdf);
    expect(detected && estimateAttachmentTokens(detected, pdf)).toBe(4_500);
  });
});

describe('attachmentName', () => {
  const png = { kind: 'image', mime: 'image/png', extension: 'png' } as const;

  it('keeps the base name, drops paths and unsafe characters, and uses the detected extension', () => {
    expect(attachmentName(encodeURIComponent('C:\\fakepath\\Zdjęcie 1.HEIC'), png)).toBe(
      'Zdjęcie 1.png',
    );
    expect(attachmentName(encodeURIComponent('../a<b>"c".svg'), png)).toBe('a_b_c_.png');
    expect(attachmentName('%E0%A4%A', png)).toBe('attachment.png');
    expect(attachmentName(null, png)).toBe('attachment.png');
  });
});
