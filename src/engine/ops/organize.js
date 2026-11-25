import { PDFDocument } from '@cantoo/pdf-lib';
import { MAX_PAGES } from '../../security/limits.js';

export async function loadPdfSafe(bytes, options = {}) {
  const doc = await PDFDocument.load(bytes, {
    updateMetadata: false,
    ...options
  });
  if (doc.getPageCount() > MAX_PAGES) {
    throw new Error(`Dokument hat ${doc.getPageCount()} Seiten (Limit: ${MAX_PAGES} Seiten).`);
  }
  return doc;
}

export async function mergePdfs(fileBytesList) {
  if (!Array.isArray(fileBytesList) || fileBytesList.length < 2) {
    throw new Error('Bitte wähle mindestens zwei PDF-Dateien zum Zusammenfügen aus.');
  }
  const merged = await PDFDocument.create();
  let totalPages = 0;

  for (const bytes of fileBytesList) {
    const src = await loadPdfSafe(bytes);
    const count = src.getPageCount();
    totalPages += count;
    if (totalPages > MAX_PAGES) {
      throw new Error(`Gesamtzahl der Seiten überschreitet das Limit von ${MAX_PAGES}.`);
    }
    const copied = await merged.copyPages(src, src.getPageIndices());
    for (const page of copied) {
      merged.addPage(page);
    }
  }
  return await merged.save({ useObjectStreams: true });
}

export async function organizePdf(fileBytesList, planItems) {
  if (!Array.isArray(planItems) || planItems.length === 0) {
    throw new Error('Mindestens eine Seite muss im Dokument verbleiben.');
  }
  if (planItems.length > MAX_PAGES) {
    throw new Error(`Maximal ${MAX_PAGES} Ausgabeseiten erlaubt.`);
  }
  const loadedDocs = [];
  for (const bytes of fileBytesList) {
    loadedDocs.push(await loadPdfSafe(bytes));
  }

  const out = await PDFDocument.create();
  for (const item of planItems) {
    const src = loadedDocs[item.fileIndex];
    if (!src) throw new Error('Ungültige Dateiquelle im Seitenplan.');
    if (item.pageIndex < 0 || item.pageIndex >= src.getPageCount()) {
      throw new Error('Ungültiger Seitenindex im Seitenplan.');
    }
    const [copied] = await out.copyPages(src, [item.pageIndex]);
    const extraRot = Number(item.rotateDeg) || 0;
    if (extraRot !== 0) {
      const currentAngle = copied.getRotation().angle;
      copied.setRotation({ type: 'degrees', angle: (currentAngle + extraRot + 360) % 360 });
    }
    out.addPage(copied);
  }
  return await out.save({ useObjectStreams: true });
}

export async function extractPages(bytes, pageIndices, { separateFiles = false } = {}) {
  const src = await loadPdfSafe(bytes);
  if (!Array.isArray(pageIndices) || pageIndices.length === 0) {
    throw new Error('Bitte wähle mindestens eine Seite aus.');
  }

  if (!separateFiles) {
    const out = await PDFDocument.create();
    const copied = await out.copyPages(src, pageIndices);
    for (const page of copied) out.addPage(page);
    return [{ nameSuffix: 'extrahiert', bytes: await out.save({ useObjectStreams: true }) }];
  }

  const outputs = [];
  for (const idx of pageIndices) {
    const single = await PDFDocument.create();
    const [copied] = await single.copyPages(src, [idx]);
    single.addPage(copied);
    outputs.push({
      nameSuffix: `seite-${String(idx + 1).padStart(3, '0')}`,
      bytes: await single.save({ useObjectStreams: true })
    });
  }
  return outputs;
}

export async function deletePages(bytes, indicesToDelete) {
  const src = await loadPdfSafe(bytes);
  const delSet = new Set(indicesToDelete);
  const keep = src.getPageIndices().filter((idx) => !delSet.has(idx));
  if (keep.length === 0) {
    throw new Error('Du kannst nicht alle Seiten löschen. Mindestens eine Seite muss übrig bleiben.');
  }
  const out = await PDFDocument.create();
  const copied = await out.copyPages(src, keep);
  for (const page of copied) out.addPage(page);
  return await out.save({ useObjectStreams: true });
}

export async function splitPdf(bytes, { mode = 'all', chunkSize = 1, groups = [] } = {}) {
  const src = await loadPdfSafe(bytes);
  const total = src.getPageCount();
  const batches = [];

  if (mode === 'all') {
    for (let i = 0; i < total; i++) {
      batches.push({ label: `seite-${String(i + 1).padStart(3, '0')}`, indices: [i] });
    }
  } else if (mode === 'fixed') {
    const size = Math.max(1, Math.min(total, Math.trunc(Number(chunkSize) || 1)));
    for (let i = 0; i < total; i += size) {
      const slice = [];
      for (let j = i; j < Math.min(total, i + size); j++) slice.push(j);
      batches.push({ label: `teil-${batches.length + 1}`, indices: slice });
    }
  } else if (mode === 'groups') {
    if (!Array.isArray(groups) || groups.length === 0) {
      throw new Error('Bitte gib mindestens einen Seitenbereich zum Trennen an.');
    }
    groups.forEach((indices, idx) => {
      if (indices.length > 0) batches.push({ label: `teil-${idx + 1}`, indices });
    });
  } else {
    throw new Error('Unbekannter Trenn-Modus.');
  }

  const results = [];
  for (const batch of batches) {
    const partDoc = await PDFDocument.create();
    const copied = await partDoc.copyPages(src, batch.indices);
    for (const p of copied) partDoc.addPage(p);
    results.push({
      nameSuffix: batch.label,
      bytes: await partDoc.save({ useObjectStreams: true })
    });
  }
  return results;
}

export async function rotatePages(bytes, { angleDeg = 90, pageIndices = null } = {}) {
  const src = await loadPdfSafe(bytes);
  const delta = ((angleDeg % 360) + 360) % 360;
  const targets = pageIndices ? new Set(pageIndices) : null;
  const pages = src.getPages();
  pages.forEach((page, idx) => {
    if (!targets || targets.has(idx)) {
      const current = page.getRotation().angle;
      page.setRotation({ type: 'degrees', angle: (current + delta) % 360 });
    }
  });
  return await src.save({ useObjectStreams: true });
}

export async function nupPdf(bytes, { perSheet = 2, landscape = true, border = false } = {}) {
  const src = await loadPdfSafe(bytes);
  const out = await PDFDocument.create();
  const count = src.getPageCount();
  const embeddedPages = await out.embedPages(src.getPages());

  const layouts = {
    2: landscape ? { cols: 2, rows: 1, w: 841.89, h: 595.28 } : { cols: 1, rows: 2, w: 595.28, h: 841.89 },
    4: landscape ? { cols: 2, rows: 2, w: 841.89, h: 595.28 } : { cols: 2, rows: 2, w: 595.28, h: 841.89 },
    6: landscape ? { cols: 3, rows: 2, w: 841.89, h: 595.28 } : { cols: 2, rows: 3, w: 595.28, h: 841.89 },
    9: { cols: 3, rows: 3, w: landscape ? 841.89 : 595.28, h: landscape ? 595.28 : 841.89 }
  };
  const cfg = layouts[perSheet] || layouts[2];
  const margin = 18;
  const gap = 12;
  const cellW = (cfg.w - margin * 2 - gap * (cfg.cols - 1)) / cfg.cols;
  const cellH = (cfg.h - margin * 2 - gap * (cfg.rows - 1)) / cfg.rows;

  for (let i = 0; i < count; i += cfg.cols * cfg.rows) {
    const sheet = out.addPage([cfg.w, cfg.h]);
    for (let slot = 0; slot < cfg.cols * cfg.rows; slot++) {
      const pageIdx = i + slot;
      if (pageIdx >= count) break;
      const emb = embeddedPages[pageIdx];
      const col = slot % cfg.cols;
      const row = Math.floor(slot / cfg.cols);
      const cellX = margin + col * (cellW + gap);
      const cellY = cfg.h - margin - (row + 1) * cellH - row * gap;

      const scale = Math.min(cellW / emb.width, cellH / emb.height);
      const drawW = emb.width * scale;
      const drawH = emb.height * scale;
      const dx = cellX + (cellW - drawW) / 2;
      const dy = cellY + (cellH - drawH) / 2;

      sheet.drawPage(emb, { x: dx, y: dy, width: drawW, height: drawH });
      if (border) {
        sheet.drawRectangle({
          x: dx,
          y: dy,
          width: drawW,
          height: drawH,
          borderWidth: 0.6
        });
      }
    }
  }
  return await out.save({ useObjectStreams: true });
}

export async function bookletPdf(bytes) {
  const src = await loadPdfSafe(bytes);
  const origCount = src.getPageCount();
  const paddedTotal = Math.max(4, Math.ceil(origCount / 4) * 4);
  if (paddedTotal > MAX_PAGES) {
    throw new Error(`Broschüren-Ausschießen überschreitet Limit von ${MAX_PAGES} Seiten.`);
  }
  const out = await PDFDocument.create();
  const embedded = await out.embedPages(src.getPages());

  const sheetW = 841.89; // A4 Landscape
  const sheetH = 595.28;
  const halfW = sheetW / 2;
  const margin = 12;

  const drawHalf = (sheet, pageOneBased, isRightSide) => {
    if (pageOneBased < 1 || pageOneBased > origCount) return;
    const emb = embedded[pageOneBased - 1];
    const slotW = halfW - margin * 2;
    const slotH = sheetH - margin * 2;
    const scale = Math.min(slotW / emb.width, slotH / emb.height);
    const drawW = emb.width * scale;
    const drawH = emb.height * scale;
    const baseX = isRightSide ? halfW + margin : margin;
    const dx = baseX + (slotW - drawW) / 2;
    const dy = margin + (slotH - drawH) / 2;
    sheet.drawPage(emb, { x: dx, y: dy, width: drawW, height: drawH });
  };

  for (let s = 0; s < paddedTotal / 4; s++) {
    // Front of sheet: [paddedTotal - 2s, 1 + 2s]
    const front = out.addPage([sheetW, sheetH]);
    drawHalf(front, paddedTotal - 2 * s, false);
    drawHalf(front, 1 + 2 * s, true);

    // Back of sheet: [2 + 2s, paddedTotal - 2s - 1]
    const back = out.addPage([sheetW, sheetH]);
    drawHalf(back, 2 + 2 * s, false);
    drawHalf(back, paddedTotal - 2 * s - 1, true);
  }
  return await out.save({ useObjectStreams: true });
}

export async function splitHalfOrPosterPdf(bytes, { mode = 'vertical' } = {}) {
  const src = await loadPdfSafe(bytes);
  const out = await PDFDocument.create();
  const embedded = await out.embedPages(src.getPages());

  const tiles =
    mode === 'horizontal'
      ? [{ col: 0, row: 1 }, { col: 0, row: 0 }] // Top first, then bottom
      : mode === 'poster-2x2'
        ? [{ col: 0, row: 1 }, { col: 1, row: 1 }, { col: 0, row: 0 }, { col: 1, row: 0 }]
        : [{ col: 0, row: 0 }, { col: 1, row: 0 }]; // vertical left, right

  const cols = mode === 'horizontal' ? 1 : 2;
  const rows = mode === 'vertical' ? 1 : 2;

  if (embedded.length * tiles.length > MAX_PAGES) {
    throw new Error(`Ausgabe würde das Limit von ${MAX_PAGES} Seiten überschreiten.`);
  }

  for (const emb of embedded) {
    const tileW = emb.width / cols;
    const tileH = emb.height / rows;
    for (const tile of tiles) {
      const page = out.addPage([tileW, tileH]);
      page.drawPage(emb, {
        x: -tile.col * tileW,
        y: -tile.row * tileH,
        width: emb.width,
        height: emb.height
      });
    }
  }
  return await out.save({ useObjectStreams: true });
}
