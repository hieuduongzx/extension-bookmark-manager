/**
 * Renders the Bookmark Manager icon at 16/32/48/128 px from a single SVG.
 *
 * Run: `node scripts/generate-icons.mjs`
 *
 * Design: a rounded square in the project's brand blue gradient
 * (Tailwind blue-500 → blue-600, matching `tailwind.config.js`) with a
 * stylised bookmark ribbon mark. Looks good at 16px because the mark is a
 * single chunky shape with strong contrast.
 */
import sharp from "sharp";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(__dirname, "..", "public", "icons");

const svg = (size) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 128 128">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#3b82f6"/>
      <stop offset="100%" stop-color="#2563eb"/>
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="128" height="128" rx="28" ry="28" fill="url(#bg)"/>
  <!-- Bookmark ribbon -->
  <path
    d="M40 26 H88 a4 4 0 0 1 4 4 V104 L64 86 L36 104 V30 a4 4 0 0 1 4 -4 z"
    fill="#ffffff"
  />
  ${
    size >= 32
      ? `<rect x="50" y="50" width="28" height="6" rx="2" fill="#3b82f6"/>
         <rect x="50" y="62" width="20" height="6" rx="2" fill="#3b82f6"/>`
      : `<rect x="50" y="54" width="28" height="8" rx="2" fill="#3b82f6"/>`
  }
</svg>`;

async function main() {
  await mkdir(outDir, { recursive: true });
  for (const size of [16, 32, 48, 128]) {
    const out = resolve(outDir, `icon-${size}.png`);
    const buf = await sharp(Buffer.from(svg(size)))
      .resize(size, size)
      .png()
      .toBuffer();
    await writeFile(out, buf);
    console.log(`generated ${out} (${buf.length} bytes)`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
