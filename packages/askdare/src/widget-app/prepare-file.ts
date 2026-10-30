/** Longest image edge sent to the model; larger photos only cost upload time. */
const MAX_EDGE = 2048;
const JPEG_QUALITY = 0.85;
const IMAGE_NAME = /\.(png|jpe?g|webp|gif|heic|heif|avif|bmp)$/i;

export interface AllowedFiles {
  readonly images: boolean;
  readonly pdf: boolean;
}

export interface PreparedFile {
  readonly blob: Blob;
  readonly name: string;
  readonly kind: 'image' | 'pdf';
}

export class UnsupportedFileError extends Error {}

const isPdf = (file: File): boolean => file.type === 'application/pdf' || /\.pdf$/i.test(file.name);

const isImage = (file: File): boolean =>
  (file.type.startsWith('image/') && file.type !== 'image/svg+xml') || IMAGE_NAME.test(file.name);

const baseName = (name: string): string => name.replace(/\.[^.]*$/, '') || 'image';

/** The `accept` attribute for the file picker. */
export function acceptTypes(allowed: AllowedFiles): string {
  return [
    ...(allowed.images ? ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/heic'] : []),
    ...(allowed.pdf ? ['application/pdf'] : []),
  ].join(',');
}

async function encodeJpeg(bitmap: ImageBitmap, width: number, height: number): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new UnsupportedFileError();
  // JPEG has no transparency: paint it white instead of black.
  context.fillStyle = '#fff';
  context.fillRect(0, 0, width, height);
  context.drawImage(bitmap, 0, 0, width, height);
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new UnsupportedFileError())),
      'image/jpeg',
      JPEG_QUALITY,
    ),
  );
}

/**
 * Gets a file ready to upload. Images are decoded, downsized and re-encoded as JPEG in the
 * browser, which drops EXIF data such as the GPS position and turns HEIC photos into a format
 * OpenAI accepts (where the browser can decode HEIC). PDFs are sent as they are.
 */
export async function prepareFile(file: File, allowed: AllowedFiles): Promise<PreparedFile> {
  if (allowed.pdf && isPdf(file)) return { blob: file, name: file.name, kind: 'pdf' };
  if (!allowed.images || !isImage(file)) throw new UnsupportedFileError();
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new UnsupportedFileError();
  }
  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const blob = await encodeJpeg(bitmap, width, height);
    return { blob, name: `${baseName(file.name)}.jpg`, kind: 'image' };
  } finally {
    bitmap.close();
  }
}
