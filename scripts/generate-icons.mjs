/**
 * Renders the Bookmark Manager icon at 16/32/48/128 px from public/icons/BookmarkManager.svg.
 *
 * Run: `node scripts/generate-icons.mjs`
 *
 * Design: *2k family icon — dark squircle (#2c2c31 → #121214) with subtle inner rim,
 * cyan-blue accent folder tab (#38bdf8 → #2563eb), crisp white bookmark ribbon,
 * and dark star cutout for instant legibility from 16px to 128px.
 */
import sharp from 'sharp';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(__dirname, '..', 'public', 'icons');
const svgPath = resolve(outDir, 'BookmarkManager.svg');

async function main() {
  await mkdir(outDir, { recursive: true });
  const svgBuffer = await readFile(svgPath);
  for (const size of [16, 32, 48, 128]) {
    const out = resolve(outDir, `icon-${size}.png`);
    const buf = await sharp(svgBuffer, { density: 300 })
      .resize(size, size, { kernel: sharp.kernel.lanczos3 })
      .png({ compressionLevel: 9 })
      .toBuffer();
    await writeFile(out, buf);
    console.log(`generated ${out} (${buf.length} bytes)`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
