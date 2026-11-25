import { PDFDocument, PDFName, PDFString, StandardFonts, degrees, rgb } from '@cantoo/pdf-lib';
import { loadPdfSafe } from './organize.js';

const MM_TO_PT = 72 / 25.4;

export const PAGE_FORMATS_PT = {
  A3: [841.89, 1190.55],
  A4: [595.28, 841.89],
  A5: [419.53, 595.28],
  Letter: [612, 792],
  Legal: [612, 1008]
};

function hexToRgb(hex) {
  const clean = /^#?([0-9a-fA-F]{6})$/.exec(String(hex || ''));
  if (!clean) return rgb(0.95, 0.63, 0.03);
  const val = parseInt(clean[1], 16);
  return rgb(((val >> 16) & 255) / 255, ((val >> 8) & 255) / 255, (val & 255) / 255);
}

export async function addWatermark(bytes, {
  text = 'VERTRAULICH',
  imageBytes = null,
  imageType = null,
  opacity = 0.25,
  angleDeg = 45,
  fontSize = 48,
  colorHex = '#f2a007',
  tile = false,
  pageIndices = null
} = {}) {
  const doc = await loadPdfSafe(bytes);
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  let embeddedImg = null;
  if (imageBytes) {
    embeddedImg = imageType === 'jpeg' ? await doc.embedJpg(imageBytes) : await doc.embedPng(imageBytes);
  }
  const color = hexToRgb(colorHex);
  const safeOpacity = Math.max(0.05, Math.min(1, Number(opacity) || 0.25));
  const safeAngle = Number(angleDeg) || 0;
  const safeSize = Math.max(10, Math.min(140, Number(fontSize) || 48));
  const targets = pageIndices ? new Set(pageIndices) : null;

  doc.getPages().forEach((page, idx) => {
    if (targets && !targets.has(idx)) return;
    const { width, height } = page.getSize();

    if (embeddedImg) {
      const maxDim = Math.min(width, height) * 0.45;
      const scale = Math.min(maxDim / embeddedImg.width, maxDim / embeddedImg.height);
      const iw = embeddedImg.width * scale;
      const ih = embeddedImg.height * scale;
      if (tile) {
        for (let y = ih * 0.5; y < height; y += ih * 1.8) {
          for (let x = iw * 0.3; x < width; x += iw * 1.8) {
            page.drawImage(embeddedImg, {
              x,
              y,
              width: iw * 0.6,
              height: ih * 0.6,
              opacity: safeOpacity,
              rotate: degrees(safeAngle)
            });
          }
        }
      } else {
        page.drawImage(embeddedImg, {
          x: (width - iw) / 2,
          y: (height - ih) / 2,
          width: iw,
          height: ih,
          opacity: safeOpacity,
          rotate: degrees(safeAngle)
        });
      }
      return;
    }

    const safeText = String(text || 'SEELIG PDF').slice(0, 120);
    const textW = font.widthOfTextAtSize(safeText, safeSize);
    if (tile) {
      const stepX = Math.max(160, textW + 70);
      const stepY = Math.max(130, safeSize * 3);
      for (let y = 40; y < height; y += stepY) {
        for (let x = 20; x < width; x += stepX) {
          page.drawText(safeText, {
            x,
            y,
            size: safeSize * 0.65,
            font,
            color,
            opacity: safeOpacity,
            rotate: degrees(safeAngle)
          });
        }
      }
    } else {
      const rad = (safeAngle * Math.PI) / 180;
      const cx = width / 2 - (textW / 2) * Math.cos(rad);
      const cy = height / 2 - (textW / 2) * Math.sin(rad);
      page.drawText(safeText, {
        x: cx,
        y: cy,
        size: safeSize,
        font,
        color,
        opacity: safeOpacity,
        rotate: degrees(safeAngle)
      });
    }
  });

  return await doc.save({ useObjectStreams: true });
}

export async function addPageNumbers(bytes, {
  position = 'bottom-center',
  format = '{n} / {total}',
  startNumber = 1,
  skipFirstPage = false,
  fontSize = 11,
  colorHex = '#333333'
} = {}) {
  const doc = await loadPdfSafe(bytes);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();
  const total = pages.length;
  const color = hexToRgb(colorHex);
  const size = Math.max(7, Math.min(32, Number(fontSize) || 11));
  const margin = 28;

  pages.forEach((page, idx) => {
    if (skipFirstPage && idx === 0) return;
    const displayNum = startNumber + idx;
    const label = String(format || '{n}')
      .replaceAll('{n}', String(displayNum))
      .replaceAll('{total}', String(total));
    const textW = font.widthOfTextAtSize(label, size);
    const { width, height } = page.getSize();

    let x = (width - textW) / 2;
    if (position.endsWith('left')) x = margin;
    if (position.endsWith('right')) x = Math.max(margin, width - margin - textW);
    const y = position.startsWith('top') ? Math.max(margin, height - margin - size) : margin;

    page.drawText(label, { x, y, size, font, color });
  });

  return await doc.save({ useObjectStreams: true });
}

export async function overlayPdf(baseBytes, overlayBytes, {
  placement = 'background',
  repeatSingleOverlay = true
} = {}) {
  const baseDoc = await loadPdfSafe(baseBytes);
  const overDoc = await loadPdfSafe(overlayBytes);
  if (overDoc.getPageCount() === 0) {
    throw new Error('Die Overlay-PDF enthält keine Seiten.');
  }
  const out = await PDFDocument.create();
  const baseEmbedded = await out.embedPages(baseDoc.getPages());
  const overEmbedded = await out.embedPages(overDoc.getPages());

  for (let i = 0; i < baseEmbedded.length; i++) {
    const basePage = baseEmbedded[i];
    const page = out.addPage([basePage.width, basePage.height]);
    const overIdx = repeatSingleOverlay && overEmbedded.length === 1 ? 0 : i;
    const overPage = overIdx < overEmbedded.length ? overEmbedded[overIdx] : null;

    if (placement === 'background' && overPage) {
      page.drawPage(overPage, { x: 0, y: 0, width: basePage.width, height: basePage.height });
    }
    page.drawPage(basePage, { x: 0, y: 0, width: basePage.width, height: basePage.height });
    if (placement === 'foreground' && overPage) {
      page.drawPage(overPage, { x: 0, y: 0, width: basePage.width, height: basePage.height });
    }
  }

  return await out.save({ useObjectStreams: true });
}

export async function cropPdf(bytes, { topMm = 0, rightMm = 0, bottomMm = 0, leftMm = 0, pageIndices = null } = {}) {
  const doc = await loadPdfSafe(bytes);
  const targets = pageIndices ? new Set(pageIndices) : null;
  const top = Math.max(0, Number(topMm) || 0) * MM_TO_PT;
  const right = Math.max(0, Number(rightMm) || 0) * MM_TO_PT;
  const bottom = Math.max(0, Number(bottomMm) || 0) * MM_TO_PT;
  const left = Math.max(0, Number(leftMm) || 0) * MM_TO_PT;

  doc.getPages().forEach((page, idx) => {
    if (targets && !targets.has(idx)) return;
    const { x, y, width, height } = page.getCropBox();
    const newW = width - left - right;
    const newH = height - top - bottom;
    if (newW < 20 || newH < 20) {
      throw new Error(`Beschnitt auf Seite ${idx + 1} zu groß (Restfläche unter 20 pt).`);
    }
    page.setCropBox(x + left, y + bottom, newW, newH);
    page.setMediaBox(x + left, y + bottom, newW, newH);
  });

  return await doc.save({ useObjectStreams: true });
}

export async function resizePdf(bytes, {
  preset = 'A4',
  orientation = 'portrait',
  customWidthMm = 210,
  customHeightMm = 297
} = {}) {
  const src = await loadPdfSafe(bytes);
  const out = await PDFDocument.create();
  const embedded = await out.embedPages(src.getPages());

  let [tw, th] = preset === 'custom'
    ? [Math.max(40, Number(customWidthMm) || 210) * MM_TO_PT, Math.max(40, Number(customHeightMm) || 297) * MM_TO_PT]
    : (PAGE_FORMATS_PT[preset] || PAGE_FORMATS_PT.A4);

  if (orientation === 'landscape' && tw < th) [tw, th] = [th, tw];
  if (orientation === 'portrait' && tw > th) [tw, th] = [th, tw];

  for (const emb of embedded) {
    const page = out.addPage([tw, th]);
    const scale = Math.min(tw / emb.width, th / emb.height);
    const drawW = emb.width * scale;
    const drawH = emb.height * scale;
    page.drawPage(emb, {
      x: (tw - drawW) / 2,
      y: (th - drawH) / 2,
      width: drawW,
      height: drawH
    });
  }

  return await out.save({ useObjectStreams: true });
}

export async function applyVisualEdits(bytes, edits = []) {
  const doc = await loadPdfSafe(bytes);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();

  for (const edit of edits) {
    const pageIdx = (Number(edit.pageNumber) || 1) - 1;
    const page = pages[pageIdx];
    if (!page) continue;
    const { width, height } = page.getSize();

    if (edit.type === 'text') {
      const size = Math.max(8, Math.min(72, Number(edit.fontSize) || 16));
      const x = Math.max(0, Math.min(width - 10, edit.x * width));
      const y = Math.max(size, Math.min(height, height - edit.y * height - size));
      page.drawText(String(edit.text || '').slice(0, 500), {
        x,
        y,
        size,
        font,
        color: hexToRgb(edit.colorHex || '#121212')
      });
    } else if (edit.type === 'rect' || edit.type === 'highlight') {
      const rw = Math.max(4, edit.w * width);
      const rh = Math.max(4, edit.h * height);
      const rx = edit.x * width;
      const ry = height - edit.y * height - rh;
      page.drawRectangle({
        x: rx,
        y: ry,
        width: rw,
        height: rh,
        color: hexToRgb(edit.colorHex || '#f2cb07'),
        opacity: edit.type === 'highlight' ? 0.35 : 0.15,
        borderColor: hexToRgb(edit.colorHex || '#f2a007'),
        borderWidth: edit.type === 'highlight' ? 0 : 1.5
      });
    } else if (edit.type === 'image' && edit.imageBytes) {
      const img = edit.imageType === 'jpeg'
        ? await doc.embedJpg(edit.imageBytes)
        : await doc.embedPng(edit.imageBytes);
      const iw = Math.max(16, edit.w * width);
      const ih = Math.max(16, edit.h * height);
      const ix = edit.x * width;
      const iy = height - edit.y * height - ih;
      page.drawImage(img, { x: ix, y: iy, width: iw, height: ih });
    }
  }

  return await doc.save({ useObjectStreams: true });
}

export async function inspectFormFields(bytes) {
  const doc = await loadPdfSafe(bytes);
  const form = doc.getForm();
  return form.getFields().map((field) => {
    const name = field.getName();
    const ctor = field.constructor?.name || '';
    if (ctor.includes('CheckBox')) {
      return { name, kind: 'checkbox', value: field.isChecked() };
    }
    if (ctor.includes('Dropdown')) {
      return { name, kind: 'dropdown', value: field.getSelected()?.[0] || '', options: field.getOptions() };
    }
    if (ctor.includes('RadioGroup')) {
      return { name, kind: 'radio', value: field.getSelected() || '', options: field.getOptions() };
    }
    if (ctor.includes('TextField')) {
      return { name, kind: 'text', value: field.getText() || '' };
    }
    return { name, kind: 'other', value: '' };
  });
}

export async function fillFormFields(bytes, valuesMap, { flatten = false } = {}) {
  const doc = await loadPdfSafe(bytes);
  const form = doc.getForm();
  for (const field of form.getFields()) {
    const name = field.getName();
    if (!(name in valuesMap)) continue;
    const val = valuesMap[name];
    const ctor = field.constructor?.name || '';
    if (ctor.includes('CheckBox')) {
      if (val) field.check();
      else field.uncheck();
    } else if (ctor.includes('Dropdown') || ctor.includes('RadioGroup')) {
      if (val) field.select(String(val));
    } else if (ctor.includes('TextField')) {
      field.setText(String(val ?? ''));
    }
  }
  if (flatten) {
    form.flatten();
  }
  return await doc.save({ useObjectStreams: true });
}

export async function setBookmarks(bytes, items = []) {
  const doc = await loadPdfSafe(bytes);
  const pages = doc.getPages();
  const context = doc.context;

  // Clean existing outlines first
  doc.catalog.delete(PDFName.of('Outlines'));

  const validItems = items
    .map((it) => ({
      title: String(it.title || '').trim().slice(0, 120),
      pageIndex: Math.max(0, Math.min(pages.length - 1, (Number(it.pageNumber) || 1) - 1))
    }))
    .filter((it) => it.title.length > 0);

  if (validItems.length === 0) {
    return await doc.save({ useObjectStreams: true });
  }

  const outlineRoot = context.obj({
    Type: 'Outlines',
    Count: validItems.length
  });
  const outlineRootRef = context.register(outlineRoot);

  const itemRefs = validItems.map((item) => {
    const pageRef = pages[item.pageIndex].ref;
    const dict = context.obj({
      Title: PDFString.of(item.title),
      Parent: outlineRootRef,
      Dest: [pageRef, PDFName.of('Fit')]
    });
    return { dict, ref: context.register(dict) };
  });

  for (let i = 0; i < itemRefs.length; i++) {
    if (i > 0) itemRefs[i].dict.set(PDFName.of('Prev'), itemRefs[i - 1].ref);
    if (i < itemRefs.length - 1) itemRefs[i].dict.set(PDFName.of('Next'), itemRefs[i + 1].ref);
  }

  outlineRoot.set(PDFName.of('First'), itemRefs[0].ref);
  outlineRoot.set(PDFName.of('Last'), itemRefs[itemRefs.length - 1].ref);
  doc.catalog.set(PDFName.of('Outlines'), outlineRootRef);

  return await doc.save({ useObjectStreams: true });
}

export async function inspectPdfInfo(bytes) {
  const rawText = new TextDecoder('latin1').decode(bytes.subarray(0, Math.min(bytes.length, 512 * 1024)));
  const headerMatch = /%PDF-(\d\.\d)/.exec(rawText.slice(0, 128));
  const version = headerMatch ? headerMatch[1] : 'Unbekannt';
  const hasJsTokens = /\/(?:JavaScript|JS|OpenAction|AA|Launch|SubmitForm|ImportData)\b/.test(rawText);

  let doc;
  let encryptedWithoutPwd = false;
  try {
    doc = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch {
    encryptedWithoutPwd = true;
    doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  }

  const pages = doc.getPages();
  const firstSize = pages[0]?.getSize() || { width: 0, height: 0 };
  let formCount = 0;
  try {
    formCount = doc.getForm().getFields().length;
  } catch {
    formCount = 0;
  }

  return {
    version,
    pageCount: pages.length,
    firstPageMm: {
      width: Math.round((firstSize.width / MM_TO_PT) * 10) / 10,
      height: Math.round((firstSize.height / MM_TO_PT) * 10) / 10
    },
    isEncrypted: encryptedWithoutPwd || Boolean(doc.context.trailerInfo.Encrypt),
    hasXmpMetadata: doc.catalog.has(PDFName.of('Metadata')),
    hasOutlines: doc.catalog.has(PDFName.of('Outlines')),
    hasActiveScriptTokens: hasJsTokens,
    formFieldCount: formCount,
    metadata: {
      title: doc.getTitle() || '',
      author: doc.getAuthor() || '',
      subject: doc.getSubject() || '',
      keywords: doc.getKeywords() || '',
      creator: doc.getCreator() || '',
      producer: doc.getProducer() || ''
    }
  };
}

export async function writeMetadata(bytes, metadata = {}) {
  const doc = await loadPdfSafe(bytes);
  doc.setTitle(String(metadata.title || '').slice(0, 300));
  doc.setAuthor(String(metadata.author || '').slice(0, 300));
  doc.setSubject(String(metadata.subject || '').slice(0, 500));
  const kwList = String(metadata.keywords || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 30);
  doc.setKeywords(kwList);
  doc.setCreator(String(metadata.creator || 'Seelig PDF').slice(0, 200));
  doc.setProducer(String(metadata.producer || 'Seelig PDF').slice(0, 200));
  return await doc.save({ useObjectStreams: true });
}
