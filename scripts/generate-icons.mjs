import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

const ROOT = process.cwd();
const CONCEPTS_DIR = path.join(ROOT, 'brand', 'icon-concepts');
const TAURI_ICONS_DIR = path.join(ROOT, 'src-tauri', 'icons');

const CONCEPTS = {
  a: 'concept-a-dark-amber-badge.svg',
  b: 'concept-b-amber-black-mark.svg',
  c: 'concept-c-dark-document.svg',
  'pdf-dark': 'pdf-file-icon-dark.svg'
};

function parseConceptArg() {
  const arg = process.argv.find((a) => a.startsWith('--concept='));
  const val = (arg ? arg.split('=')[1] : 'pdf-dark').toLowerCase();
  if (!CONCEPTS[val]) {
    throw new Error(`Unbekanntes Konzept "${val}". Erlaubt: a, b, c, pdf-dark`);
  }
  return val;
}

function packIcoFromPngBuffers(entries) {
  // entries: [{ size, pngBuffer }]
  const count = entries.length;
  const headerSize = 6;
  const dirEntrySize = 16;
  let offset = headerSize + count * dirEntrySize;

  const header = Buffer.alloc(headerSize);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type 1 = ICO
  header.writeUInt16LE(count, 4);

  const dirBuffers = [];
  const dataBuffers = [];

  for (const { size, pngBuffer } of entries) {
    const dir = Buffer.alloc(dirEntrySize);
    dir.writeUInt8(size >= 256 ? 0 : size, 0);
    dir.writeUInt8(size >= 256 ? 0 : size, 1);
    dir.writeUInt8(0, 2); // color palette
    dir.writeUInt8(0, 3); // reserved
    dir.writeUInt16LE(1, 4); // planes
    dir.writeUInt16LE(32, 6); // bpp
    dir.writeUInt32LE(pngBuffer.length, 8);
    dir.writeUInt32LE(offset, 12);
    offset += pngBuffer.length;
    dirBuffers.push(dir);
    dataBuffers.push(pngBuffer);
  }

  return Buffer.concat([header, ...dirBuffers, ...dataBuffers]);
}

async function renderSvgSizes(page, svgString, sizes) {
  const b64 = Buffer.from(svgString, 'utf8').toString('base64');
  const results = [];
  for (const size of sizes) {
    const pngBase64 = await page.evaluate(
      async ({ dataUrl, px }) => {
        const img = new Image();
        img.src = dataUrl;
        await img.decode();
        const canvas = document.createElement('canvas');
        canvas.width = px;
        canvas.height = px;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, px, px);
        ctx.drawImage(img, 0, 0, px, px);
        return canvas.toDataURL('image/png').split(',')[1];
      },
      { dataUrl: `data:image/svg+xml;base64,${b64}`, px: size }
    );
    results.push({ size, pngBuffer: Buffer.from(pngBase64, 'base64') });
  }
  return results;
}

async function main() {
  const chosen = parseConceptArg();
  fs.mkdirSync(TAURI_ICONS_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    // 1. Render 512px previews for all concepts
    for (const [key, filename] of Object.entries(CONCEPTS)) {
      const svg = fs.readFileSync(path.join(CONCEPTS_DIR, filename), 'utf8');
      const [preview] = await renderSvgSizes(page, svg, [512]);
      const outName = key === 'pdf-dark' ? 'pdf-file-icon-dark-preview.png' : `concept-${key}-preview.png`;
      fs.writeFileSync(path.join(CONCEPTS_DIR, outName), preview.pngBuffer);
    }

    // 2. Build active Tauri icon set from chosen concept
    const activeSvg = fs.readFileSync(path.join(CONCEPTS_DIR, CONCEPTS[chosen]), 'utf8');
    const renderedApp = await renderSvgSizes(page, activeSvg, [16, 32, 48, 64, 128, 256, 512]);
    const bySize = Object.fromEntries(renderedApp.map((r) => [r.size, r.pngBuffer]));

    fs.writeFileSync(path.join(TAURI_ICONS_DIR, '32x32.png'), bySize[32]);
    fs.writeFileSync(path.join(TAURI_ICONS_DIR, '128x128.png'), bySize[128]);
    fs.writeFileSync(path.join(TAURI_ICONS_DIR, '128x128@2x.png'), bySize[256]);
    fs.writeFileSync(path.join(TAURI_ICONS_DIR, 'icon.png'), bySize[512]);

    const appIco = packIcoFromPngBuffers(
      [16, 32, 48, 64, 128, 256].map((s) => ({ size: s, pngBuffer: bySize[s] }))
    );
    fs.writeFileSync(path.join(TAURI_ICONS_DIR, 'icon.ico'), appIco);

    // 3. Build Windows Explorer .pdf file-type icon (matching dark style)
    const pdfSvg = fs.readFileSync(path.join(CONCEPTS_DIR, 'pdf-file-icon-dark.svg'), 'utf8');
    const renderedPdf = await renderSvgSizes(page, pdfSvg, [16, 32, 48, 64, 128, 256]);
    fs.writeFileSync(path.join(TAURI_ICONS_DIR, 'pdf-file.ico'), packIcoFromPngBuffers(renderedPdf));

    console.log(`Generated icon previews and active Tauri icons using "${chosen}".`);
  } finally {
    await browser.close();
  }
}

main();
