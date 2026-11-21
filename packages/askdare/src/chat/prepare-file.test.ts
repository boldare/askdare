// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { acceptTypes, prepareFile, UnsupportedFileError } from './prepare-file';

// happy-dom decodes no images and paints no canvas, so the browser's side is faked: a bitmap of a
// given size, and a canvas that records what was drawn and how it was encoded. That the re-encoded
// JPEG really carries no EXIF data is the browser's canvas behaviour, covered by the e2e tests.

const ALL = { images: true, pdf: true } as const;

interface FakeBitmap {
  readonly width: number;
  readonly height: number;
  readonly close: ReturnType<typeof vi.fn>;
}

interface Painted {
  width: number;
  height: number;
  fillStyle: string | undefined;
  fills: number[][];
  draws: unknown[][];
  type: string | undefined;
  quality: number | undefined;
}

let bitmap: FakeBitmap;
let decode: ReturnType<typeof vi.fn>;
let painted: Painted;
let context: 'ok' | 'none';
let encoded: Blob | null;

function file(name: string, type: string, bytes = 'exif+pixels'): File {
  return new File([bytes], name, { type });
}

beforeEach(() => {
  bitmap = { width: 800, height: 600, close: vi.fn() };
  decode = vi.fn(async () => bitmap);
  vi.stubGlobal('createImageBitmap', decode);
  painted = {
    width: 0,
    height: 0,
    fillStyle: undefined,
    fills: [],
    draws: [],
    type: undefined,
    quality: undefined,
  };
  context = 'ok';
  encoded = new Blob(['jpeg'], { type: 'image/jpeg' });
  const createElement = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
    if (tag !== 'canvas') return createElement(tag);
    const canvas = {
      set width(value: number) {
        painted.width = value;
      },
      set height(value: number) {
        painted.height = value;
      },
      getContext: () =>
        context === 'none'
          ? null
          : {
              set fillStyle(value: string) {
                painted.fillStyle = value;
              },
              fillRect: (...args: number[]) => void painted.fills.push(args),
              drawImage: (...args: unknown[]) => void painted.draws.push(args),
            },
      toBlob: (done: (blob: Blob | null) => void, type: string, quality: number) => {
        painted.type = type;
        painted.quality = quality;
        done(encoded);
      },
    };
    return canvas as unknown as HTMLCanvasElement;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('prepareFile: PDFs', () => {
  it('sends a PDF as it is', async () => {
    const pdf = file('terms.pdf', 'application/pdf');
    expect(await prepareFile(pdf, ALL)).toEqual({ blob: pdf, name: 'terms.pdf', kind: 'pdf' });
    expect(decode).not.toHaveBeenCalled();
  });

  it('recognises a PDF by its name when the browser gives no type', async () => {
    const pdf = file('TERMS.PDF', '');
    expect((await prepareFile(pdf, ALL)).kind).toBe('pdf');
  });

  it('refuses a PDF when the bot takes none', async () => {
    await expect(
      prepareFile(file('a.pdf', 'application/pdf'), { images: true, pdf: false }),
    ).rejects.toBeInstanceOf(UnsupportedFileError);
  });
});

describe('prepareFile: images', () => {
  it('re-encodes an image as a JPEG, so the original bytes and their metadata are not sent', async () => {
    const photo = file('IMG_0001.HEIC', 'image/heic');
    const prepared = await prepareFile(photo, ALL);
    expect(prepared).toEqual({ blob: encoded, name: 'IMG_0001.jpg', kind: 'image' });
    expect(prepared.blob).not.toBe(photo);
    expect(painted.type).toBe('image/jpeg');
    expect(painted.quality).toBe(0.85);
  });

  it('decodes with the photo orientation applied', async () => {
    const photo = file('a.jpg', 'image/jpeg');
    await prepareFile(photo, ALL);
    expect(decode).toHaveBeenCalledWith(photo, { imageOrientation: 'from-image' });
  });

  it('keeps a small image at its size, on a white background', async () => {
    await prepareFile(file('a.png', 'image/png'), ALL);
    expect([painted.width, painted.height]).toEqual([800, 600]);
    expect(painted.fillStyle).toBe('#fff');
    expect(painted.fills).toEqual([[0, 0, 800, 600]]);
    expect(painted.draws).toEqual([[bitmap, 0, 0, 800, 600]]);
  });

  it('downsizes a large landscape image to a 2048-pixel long edge', async () => {
    bitmap = { width: 4096, height: 3072, close: vi.fn() };
    await prepareFile(file('a.jpg', 'image/jpeg'), ALL);
    expect([painted.width, painted.height]).toEqual([2048, 1536]);
    expect(painted.draws[0]).toEqual([bitmap, 0, 0, 2048, 1536]);
  });

  it('downsizes a tall portrait image by its height', async () => {
    bitmap = { width: 3000, height: 5000, close: vi.fn() };
    await prepareFile(file('a.webp', 'image/webp'), ALL);
    expect([painted.width, painted.height]).toEqual([1229, 2048]);
  });

  it('never scales an edge below one pixel', async () => {
    bitmap = { width: 100_000, height: 10, close: vi.fn() };
    await prepareFile(file('strip.png', 'image/png'), ALL);
    expect([painted.width, painted.height]).toEqual([2048, 1]);
  });

  it('names the result after the file, or "image" when it has only an extension', async () => {
    expect((await prepareFile(file('holiday.photo.png', 'image/png'), ALL)).name).toBe(
      'holiday.photo.jpg',
    );
    expect((await prepareFile(file('.png', 'image/png'), ALL)).name).toBe('image.jpg');
  });

  it('recognises an image by its name when the browser gives no type', async () => {
    expect((await prepareFile(file('photo.heif', ''), ALL)).kind).toBe('image');
  });

  it('frees the bitmap, also when encoding fails', async () => {
    await prepareFile(file('a.png', 'image/png'), ALL);
    expect(bitmap.close).toHaveBeenCalledOnce();

    bitmap = { width: 10, height: 10, close: vi.fn() };
    encoded = null;
    await expect(prepareFile(file('a.png', 'image/png'), ALL)).rejects.toBeInstanceOf(
      UnsupportedFileError,
    );
    expect(bitmap.close).toHaveBeenCalledOnce();
  });

  it('fails as unsupported without a 2D canvas', async () => {
    context = 'none';
    await expect(prepareFile(file('a.png', 'image/png'), ALL)).rejects.toBeInstanceOf(
      UnsupportedFileError,
    );
    expect(bitmap.close).toHaveBeenCalledOnce();
  });

  it('fails as unsupported when the browser cannot decode it', async () => {
    decode.mockRejectedValueOnce(new DOMException('bad image', 'InvalidStateError'));
    await expect(prepareFile(file('a.heic', 'image/heic'), ALL)).rejects.toBeInstanceOf(
      UnsupportedFileError,
    );
  });

  it('refuses SVG, other types and images the bot does not take', async () => {
    for (const [name, type] of [
      ['logo.svg', 'image/svg+xml'],
      ['notes.txt', 'text/plain'],
      ['archive.zip', ''],
    ] as const) {
      await expect(prepareFile(file(name, type), ALL)).rejects.toBeInstanceOf(UnsupportedFileError);
    }
    await expect(
      prepareFile(file('a.png', 'image/png'), { images: false, pdf: true }),
    ).rejects.toBeInstanceOf(UnsupportedFileError);
    expect(decode).not.toHaveBeenCalled();
  });
});

describe('acceptTypes', () => {
  it('lists what the bot takes', () => {
    expect(acceptTypes({ images: true, pdf: true })).toBe(
      'image/png,image/jpeg,image/webp,image/gif,image/heic,application/pdf',
    );
    expect(acceptTypes({ images: false, pdf: true })).toBe('application/pdf');
    expect(acceptTypes({ images: true, pdf: false })).not.toContain('pdf');
    expect(acceptTypes({ images: false, pdf: false })).toBe('');
  });
});
