import { PDFDocument, PDFName, StandardFonts, rgb } from '@cantoo/pdf-lib';
import { zipSync } from 'fflate';
import { encode as encodeQr } from 'uqr';
import { PAGE_FORMATS_PT } from './edit.js';
import { loadPdfSafe } from './organize.js';
import { MAX_PAGES } from '../../security/limits.js';

export async function imagesToPdf(images, {
  pagePreset = 'A4',
  orientation = 'auto',
  marginMm = 12
} = {}) {
  if (!Array.isArray(images) || images.length === 0) {
    throw new Error('Bitte wähle mindestens ein Bild aus.');
  }
  if (images.length > MAX_PAGES) {
    throw new Error(`Maximal ${MAX_PAGES} Bilder pro PDF erlaubt.`);
  }
  const doc = await PDFDocument.create();
  const marginPt = Math.max(0, Math.min(60, Number(marginMm) || 0)) * (72 / 25.4);

  for (const item of images) {
    const img = item.format === 'jpeg'
      ? await doc.embedJpg(item.bytes)
      : await doc.embedPng(item.bytes);

    let pw;
    let ph;
    if (pagePreset === 'fit') {
      pw = img.width + marginPt * 2;
      ph = img.height + marginPt * 2;
    } else {
      [pw, ph] = PAGE_FORMATS_PT[pagePreset] || PAGE_FORMATS_PT.A4;
      const isLandscape =
        orientation === 'landscape' || (orientation === 'auto' && img.width > img.height);
      if (isLandscape && pw < ph) [pw, ph] = [ph, pw];
      if (!isLandscape && pw > ph) [pw, ph] = [ph, pw];
    }

    const page = doc.addPage([pw, ph]);
    const availW = Math.max(20, pw - marginPt * 2);
    const availH = Math.max(20, ph - marginPt * 2);
    const scale = Math.min(availW / img.width, availH / img.height);
    const drawW = img.width * scale;
    const drawH = img.height * scale;

    page.drawImage(img, {
      x: (pw - drawW) / 2,
      y: (ph - drawH) / 2,
      width: drawW,
      height: drawH
    });
  }

  return await doc.save({ useObjectStreams: true });
}

function wrapTextLines(text, font, size, maxWidth) {
  const words = text.split(/\s+/);
  const lines = [];
  let line = '';
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(test, size) <= maxWidth) {
      line = test;
    } else {
      if (line) lines.push(line);
      if (font.widthOfTextAtSize(word, size) <= maxWidth) {
        line = word;
      } else {
        // Hard-break overly long token
        let chunk = '';
        for (const ch of word) {
          if (font.widthOfTextAtSize(chunk + ch, size) > maxWidth && chunk) {
            lines.push(chunk);
            chunk = ch;
          } else {
            chunk += ch;
          }
        }
        line = chunk;
      }
    }
  }
  if (line) lines.push(line);
  return lines;
}

export async function textToPdf(rawText, {
  markdown = true,
  fontSize = 11,
  title = ''
} = {}) {
  const text = String(rawText || '').replace(/\r\n/g, '\n');
  if (!text.trim()) {
    throw new Error('Bitte gib Text oder Markdown ein.');
  }

  const doc = await PDFDocument.create();
  if (title) doc.setTitle(title.slice(0, 120));
  const regularFont = await doc.embedFont(StandardFonts.Helvetica);
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);

  const pageW = 595.28;
  const pageH = 841.89;
  const margin = 52;
  const maxWidth = pageW - margin * 2;
  const baseSize = Math.max(8, Math.min(20, Number(fontSize) || 11));

  let page = doc.addPage([pageW, pageH]);
  let y = pageH - margin;

  const ensureSpace = (needed) => {
    if (y - needed < margin) {
      if (doc.getPageCount() >= MAX_PAGES) {
        throw new Error(`Maximal ${MAX_PAGES} Seiten erreicht.`);
      }
      page = doc.addPage([pageW, pageH]);
      y = pageH - margin;
    }
  };

  for (const rawLine of text.split('\n')) {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      y -= baseSize * 0.7;
      continue;
    }

    let size = baseSize;
    let font = regularFont;
    let color = rgb(0.12, 0.12, 0.12);
    let content = rawLine;
    let indent = 0;

    if (markdown) {
      if (trimmed.startsWith('### ')) {
        size = baseSize + 3;
        font = boldFont;
        content = trimmed.slice(4);
      } else if (trimmed.startsWith('## ')) {
        size = baseSize + 6;
        font = boldFont;
        color = rgb(0.75, 0.43, 0.02);
        content = trimmed.slice(3);
      } else if (trimmed.startsWith('# ')) {
        size = baseSize + 10;
        font = boldFont;
        content = trimmed.slice(2);
      } else if (/^[-*]\s+/.test(trimmed)) {
        content = `•  ${trimmed.replace(/^[-*]\s+/, '')}`;
        indent = 12;
      }
    }

    const wrapped = wrapTextLines(content, font, size, maxWidth - indent);
    for (const wLine of wrapped) {
      ensureSpace(size * 1.45);
      page.drawText(wLine, {
        x: margin + indent,
        y: y - size,
        size,
        font,
        color
      });
      y -= size * 1.45;
    }
  }

  return await doc.save({ useObjectStreams: true });
}

export function createZipArchive(entries) {
  const fileMap = {};
  for (const entry of entries) {
    fileMap[entry.name] = entry.bytes;
  }
  return zipSync(fileMap, { level: 6 });
}

export function generateQrData(payload, { ecc = 'M' } = {}) {
  const text = String(payload || '').trim();
  if (!text) {
    throw new Error('Bitte gib einen Text oder Link für den QR-Code ein.');
  }
  if (text.length > 2000) {
    throw new Error('QR-Code-Inhalt darf maximal 2000 Zeichen lang sein.');
  }
  const result = encodeQr(text, { ecc });
  return {
    size: result.size,
    data: result.data
  };
}

export async function qrToPdf(qrMatrix, {
  targetPdfBytes = null,
  pageNumber = 1,
  fgHex = '#121212',
  bgHex = '#ffffff',
  sizeMm = 50,
  xPct = 0.72,
  yPct = 0.72
} = {}) {
  const doc = targetPdfBytes ? await loadPdfSafe(targetPdfBytes) : await PDFDocument.create();
  const page = targetPdfBytes
    ? doc.getPages()[Math.max(0, Math.min(doc.getPageCount() - 1, pageNumber - 1))]
    : doc.addPage(PAGE_FORMATS_PT.A4);

  const { width, height } = page.getSize();
  const boxPt = targetPdfBytes
    ? Math.max(40, Math.min(260, Number(sizeMm) * (72 / 25.4)))
    : 220;
  const xStart = targetPdfBytes ? Math.max(12, Math.min(width - boxPt - 12, xPct * width)) : (width - boxPt) / 2;
  const yStart = targetPdfBytes ? Math.max(12, Math.min(height - boxPt - 12, height - yPct * height - boxPt)) : (height - boxPt) / 2;

  const parseHex = (h, fallback) => {
    const m = /^#?([0-9a-fA-F]{6})$/.exec(String(h || ''));
    if (!m) return fallback;
    const v = parseInt(m[1], 16);
    return rgb(((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255);
  };
  const fg = parseHex(fgHex, rgb(0.07, 0.07, 0.07));
  const bg = parseHex(bgHex, rgb(1, 1, 1));

  const n = qrMatrix.size;
  const quiet = 2;
  const cell = boxPt / (n + quiet * 2);

  page.drawRectangle({ x: xStart, y: yStart, width: boxPt, height: boxPt, color: bg });
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qrMatrix.data[r][c]) {
        page.drawRectangle({
          x: xStart + (c + quiet) * cell,
          y: yStart + boxPt - (r + quiet + 1) * cell,
          width: cell + 0.1,
          height: cell + 0.1,
          color: fg
        });
      }
    }
  }

  return await doc.save({ useObjectStreams: true });
}

export async function extractEmbeddedImages(bytes) {
  const doc = await loadPdfSafe(bytes);
  const extracted = [];
  const seenRefs = new Set();

  for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
    const key = ref.toString();
    if (seenRefs.has(key)) continue;
    seenRefs.add(key);

    if (!obj || !obj.dict || typeof obj.contents === 'undefined') continue;
    const subtype = obj.dict.get(PDFName.of('Subtype'));
    if (!subtype || subtype.toString() !== '/Image') continue;

    const filter = obj.dict.get(PDFName.of('Filter'))?.toString() || '';
    const w = obj.dict.get(PDFName.of('Width'))?.asNumber?.() || 0;
    const h = obj.dict.get(PDFName.of('Height'))?.asNumber?.() || 0;
    if (w < 4 || h < 4) continue;

    if (filter.includes('DCTDecode')) {
      extracted.push({
        name: `bild-${String(extracted.length + 1).padStart(3, '0')}.jpg`,
        format: 'jpeg',
        width: w,
        height: h,
        bytes: new Uint8Array(obj.contents)
      });
    }
  }
  return extracted;
}
