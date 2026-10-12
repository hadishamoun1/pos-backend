import * as fs from 'fs';
import * as path from 'path';
// Sharp's shipped type declarations don't resolve cleanly under this
// project's (pre-Node16) module resolution — require it directly rather
// than fight the type resolution for a native-binding wrapper.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const sharp = require('sharp');

const IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export interface CompressedFileResult {
  absolutePath: string;
  mimetype: string;
  size: number;
}

// Shrinks an uploaded scanned image in place — moderate settings, tuned to
// stay comfortably readable even zoomed in (these are often customs/
// shipping documents someone may need to scrutinize closely later) while
// still cutting storage significantly. PDFs are left untouched (no external
// dependency required). Never throws: any failure just keeps the original
// file as-is, so compression can never block an upload.
export async function compressUploadedFile(
  absolutePath: string,
  mimetype: string,
): Promise<CompressedFileResult> {
  try {
    if (IMAGE_MIME_TYPES.includes(mimetype)) {
      return await compressImage(absolutePath);
    }
  } catch (err: any) {
    console.warn(
      `[compressUploadedFile] Compression failed for ${absolutePath}, keeping original: ${err?.message || err}`,
    );
  }
  const stat = fs.statSync(absolutePath);
  return { absolutePath, mimetype, size: stat.size };
}

// Resize to a max of 2000px on the long edge + re-encode as JPEG q80 —
// "visually lossless" for scanned text/stamps/signatures at normal and
// zoomed viewing, while typically cutting file size 60-80% on high-res
// scans (already-small photos just pass through close to unchanged, since
// there's little left to trim). Always normalizes to .jpg (including
// PNG/WEBP input) so the stored extension matches the actual bytes.
async function compressImage(absolutePath: string): Promise<CompressedFileResult> {
  const dir = path.dirname(absolutePath);
  const base = path.basename(absolutePath, path.extname(absolutePath));
  const outPath = path.join(dir, `${base}.jpg`);

  const buffer = await sharp(absolutePath)
    .rotate() // bake in EXIF orientation before it gets stripped
    .resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toBuffer();

  fs.writeFileSync(outPath, buffer);
  if (outPath !== absolutePath) fs.unlink(absolutePath, () => {});

  return { absolutePath: outPath, mimetype: 'image/jpeg', size: buffer.length };
}
