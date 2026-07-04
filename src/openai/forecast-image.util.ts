import sharp from 'sharp';

export function parseDataUrlToBuffer(dataUrl: string): Buffer | null {
  const m = dataUrl.trim().match(/^data:([^;]+);base64,(.+)$/is);
  if (!m) return null;
  try {
    const b64 = m[2].replace(/\s/g, '');
    return Buffer.from(b64, 'base64');
  } catch {
    return null;
  }
}

export async function bufferToPngForImageEdit(input: Buffer, maxW = 1024, maxH = 1536): Promise<Buffer> {
  return sharp(input)
    .rotate()
    .resize(maxW, maxH, { fit: 'inside', withoutEnlargement: false })
    .png({ compressionLevel: 7 })
    .toBuffer();
}

export async function getNormalizedImageSize(input: Buffer): Promise<{ width: number; height: number } | null> {
  const meta = await sharp(input).rotate().metadata();
  if (!meta.width || !meta.height) return null;
  return { width: meta.width, height: meta.height };
}

export async function resizePngToExactSize(
  inputPng: Buffer,
  width: number,
  height: number,
): Promise<Buffer> {
  return sharp(inputPng)
    .resize(width, height, {
      fit: 'contain',
      background: { r: 255, g: 255, b: 255, alpha: 1 },
      withoutEnlargement: false,
    })
    .png({ compressionLevel: 7 })
    .toBuffer();
}

export async function resizePngToFitInside(
  inputPng: Buffer,
  maxWidth: number,
  maxHeight: number,
): Promise<Buffer> {
  return sharp(inputPng)
    .resize(maxWidth, maxHeight, {
      fit: 'inside',
      withoutEnlargement: true,
    })
    .png({ compressionLevel: 7 })
    .toBuffer();
}
