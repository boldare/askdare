import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { attachmentName, countPdfPages, detectFile } from './files';

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

describe('countPdfPages', () => {
  const objectStream = (body: string, dictionary = '/Filter /FlateDecode'): Uint8Array => {
    const data = deflateSync(Buffer.from(body, 'latin1'));
    return bytes(
      `%PDF-1.7\n7 0 obj\n<< /Type /ObjStm /N 3 /First 10 ${dictionary} /Length ${data.length} >>\nstream\n`,
      [...data],
      '\nendstream\nendobj\n%%EOF\n',
    );
  };

  it('counts page objects and trusts the larger declared count', async () => {
    await expect(
      countPdfPages(bytes('%PDF-1.4 /Type /Pages /Count 2 /Type /Page /Type/Page')),
    ).resolves.toBe(2);
    await expect(countPdfPages(bytes('%PDF-1.4 /Type /Pages /Count 9 /Type /Page'))).resolves.toBe(
      9,
    );
  });

  it('finds pages hidden in compressed object streams and escaped names', async () => {
    const pages = '<< /Type /Page >> << /Type /P#61ge >> << /T#79pe /Page >>';
    await expect(countPdfPages(objectStream(pages))).resolves.toBe(3);
  });

  it('reports unknown when the structure is hidden', async () => {
    await expect(
      countPdfPages(objectStream('<< /Type /Page >>', '/Filter /LZWDecode')),
    ).resolves.toBeUndefined();
    await expect(
      countPdfPages(bytes('%PDF-1.7 /Encrypt 5 0 R /Type /Page')),
    ).resolves.toBeUndefined();
    await expect(countPdfPages(bytes('%PDF-1.7 nothing here'))).resolves.toBeUndefined();
    const broken = bytes(
      '%PDF-1.7\n1 0 obj << /Type /ObjStm /Filter /FlateDecode /Length 4 >>\nstream\nxxxx\nendstream',
    );
    await expect(countPdfPages(broken)).resolves.toBeUndefined();
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
