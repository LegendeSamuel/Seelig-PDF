import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { createTrustedWorker } from '../security/trusted-types.js';
import { MAX_CANVAS_DIM, MAX_CANVAS_PIXELS, MAX_PAGES } from '../security/limits.js';

let sharedWorker = null;

function ensurePdfJsWorker() {
  if (typeof Worker === 'undefined') return;
  if (!sharedWorker) {
    sharedWorker = createTrustedWorker(pdfWorkerUrl, { type: 'module' });
    pdfjsLib.GlobalWorkerOptions.workerPort = sharedWorker;
  }
}

export async function destroyPdfDoc(doc) {
  if (!doc) return;
  try {
    if (typeof doc.cleanup === 'function') await doc.cleanup();
  } catch {
    // ignore cleanup error
  }
  try {
    if (doc.loadingTask && typeof doc.loadingTask.destroy === 'function') {
      await doc.loadingTask.destroy();
    } else if (typeof doc.destroy === 'function') {
      await doc.destroy();
    }
  } catch {
    // ignore destroy error
  }
}

export async function openHardenedPdfDocument(bytes, { password } = {}) {
  ensurePdfJsWorker();
  const dataCopy = new Uint8Array(bytes);
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const loadingTask = pdfjsLib.getDocument({
    data: dataCopy,
    password,
    standardFontDataUrl: `${origin}/pdfjs/standard_fonts/`,
    cMapUrl: `${origin}/pdfjs/cmaps/`,
    cMapPacked: true,
    isEvalSupported: false,
    enableScripting: false,
    useSystemFonts: false,
    useWasm: false,
    isOffscreenCanvasSupported: false,
    stopAtErrors: false
  });
  const doc = await loadingTask.promise;
  if (doc.numPages > MAX_PAGES) {
    await destroyPdfDoc(doc);
    throw new Error(`Dokument hat ${doc.numPages} Seiten (Limit: ${MAX_PAGES} Seiten).`);
  }
  return doc;
}

export async function getPdfPageCount(bytes, { password } = {}) {
  const doc = await openHardenedPdfDocument(bytes, { password });
  try {
    return doc.numPages;
  } finally {
    await destroyPdfDoc(doc);
  }
}

function clampViewportScale(page, requestedScale) {
  const base = page.getViewport({ scale: 1 });
  let scale = requestedScale;
  const maxDimScale = Math.min(MAX_CANVAS_DIM / base.width, MAX_CANVAS_DIM / base.height);
  if (scale > maxDimScale) scale = maxDimScale;
  const areaAtScale = base.width * scale * (base.height * scale);
  if (areaAtScale > MAX_CANVAS_PIXELS) {
    scale *= Math.sqrt(MAX_CANVAS_PIXELS / areaAtScale);
  }
  return Math.max(0.1, scale);
}

export async function renderPdfPageToCanvas(doc, pageNumber, canvas, { scale = 1.5, rotation = 0 } = {}) {
  const page = await doc.getPage(pageNumber);
  try {
    const safeScale = clampViewportScale(page, scale);
    const viewport = page.getViewport({ scale: safeScale, rotation });
    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));
    const ctx = canvas.getContext('2d', { willReadFrequently: false });
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    return { width: canvas.width, height: canvas.height, ptWidth: page.view[2] - page.view[0], ptHeight: page.view[3] - page.view[1] };
  } finally {
    page.cleanup();
  }
}

function canvasToUint8Array(canvas, mimeType, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      async (blob) => {
        if (!blob) {
          reject(new Error('Canvas-Export fehlgeschlagen.'));
          return;
        }
        resolve(new Uint8Array(await blob.arrayBuffer()));
      },
      mimeType,
      quality
    );
  });
}

export async function renderPdfToImages(bytes, {
  format = 'png',
  dpi = 150,
  quality = 0.88,
  pageIndices = null,
  filterMode = 'none',
  redactionsByPage = null,
  onProgress = null
} = {}) {
  const doc = await openHardenedPdfDocument(bytes);
  const scale = Math.max(0.5, Math.min(4, dpi / 72));
  const mime = format === 'jpeg' ? 'image/jpeg' : 'image/png';
  const targetPages = pageIndices && pageIndices.length > 0
    ? pageIndices.map((i) => i + 1)
    : Array.from({ length: doc.numPages }, (_, idx) => idx + 1);

  const results = [];
  const canvas = document.createElement('canvas');

  try {
    for (let i = 0; i < targetPages.length; i++) {
      const pageNum = targetPages[i];
      await renderPdfPageToCanvas(doc, pageNum, canvas, { scale });
      const ctx = canvas.getContext('2d');

      if (filterMode === 'grayscale' || filterMode === 'invert') {
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const d = imgData.data;
        if (filterMode === 'grayscale') {
          for (let p = 0; p < d.length; p += 4) {
            const lum = Math.round(0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2]);
            d[p] = lum;
            d[p + 1] = lum;
            d[p + 2] = lum;
          }
        } else {
          for (let p = 0; p < d.length; p += 4) {
            d[p] = 255 - d[p];
            d[p + 1] = 255 - d[p + 1];
            d[p + 2] = 255 - d[p + 2];
          }
        }
        ctx.putImageData(imgData, 0, 0);
      }

      const boxes = redactionsByPage?.get(pageNum);
      if (boxes && boxes.length > 0) {
        ctx.save();
        ctx.fillStyle = '#000000';
        for (const box of boxes) {
          const rx = Math.max(0, Math.floor(box.x * canvas.width));
          const ry = Math.max(0, Math.floor(box.y * canvas.height));
          const rw = Math.max(1, Math.ceil(box.w * canvas.width));
          const rh = Math.max(1, Math.ceil(box.h * canvas.height));
          ctx.fillRect(rx, ry, rw, rh);
        }
        ctx.restore();
      }

      const imgBytes = await canvasToUint8Array(canvas, mime, quality);
      results.push({
        pageNumber: pageNum,
        width: canvas.width,
        height: canvas.height,
        format: format === 'jpeg' ? 'jpeg' : 'png',
        bytes: imgBytes
      });

      if (onProgress) {
        onProgress((i + 1) / targetPages.length, `Seite ${i + 1} von ${targetPages.length} gerendert`);
      }
    }
    return results;
  } finally {
    canvas.width = 0;
    canvas.height = 0;
    await destroyPdfDoc(doc);
  }
}

export async function extractPdfText(bytes, { markdown = false, onProgress = null } = {}) {
  const doc = await openHardenedPdfDocument(bytes);
  const pages = [];
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      try {
        const content = await page.getTextContent();
        const lines = [];
        let currentLine = [];
        let lastY = null;

        for (const item of content.items) {
          if (!('str' in item)) continue;
          const y = Array.isArray(item.transform) ? Math.round(item.transform[5]) : null;
          if (lastY !== null && y !== null && Math.abs(y - lastY) > 4 && currentLine.length > 0) {
            lines.push(currentLine.join(' ').replace(/\s+/g, ' ').trim());
            currentLine = [];
          }
          if (item.str.trim().length > 0) {
            currentLine.push(item.str);
          }
          if (y !== null) lastY = y;
        }
        if (currentLine.length > 0) {
          lines.push(currentLine.join(' ').replace(/\s+/g, ' ').trim());
        }
        const text = lines.filter(Boolean).join('\n');
        pages.push(markdown ? `## Seite ${p}\n\n${text}` : `--- Seite ${p} ---\n${text}`);
      } finally {
        page.cleanup();
      }
      if (onProgress) onProgress(p / doc.numPages, `Text auf Seite ${p}/${doc.numPages} gelesen`);
    }
    return { pageCount: doc.numPages, text: pages.join('\n\n') };
  } finally {
    await destroyPdfDoc(doc);
  }
}
