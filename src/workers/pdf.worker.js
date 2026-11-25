import {
  bookletPdf,
  deletePages,
  extractPages,
  mergePdfs,
  nupPdf,
  organizePdf,
  rotatePages,
  splitHalfOrPosterPdf,
  splitPdf
} from '../engine/ops/organize.js';
import {
  addPageNumbers,
  addWatermark,
  applyVisualEdits,
  cropPdf,
  fillFormFields,
  inspectFormFields,
  inspectPdfInfo,
  overlayPdf,
  resizePdf,
  setBookmarks,
  writeMetadata
} from '../engine/ops/edit.js';
import {
  createZipArchive,
  extractEmbeddedImages,
  generateQrData,
  imagesToPdf,
  qrToPdf,
  textToPdf
} from '../engine/ops/convert.js';
import {
  buildRedactedPdf,
  compressPdfLossless,
  flattenAcroForm,
  protectPdf,
  rebuildPdfFromImages,
  stripMetadata,
  unlockPdf
} from '../engine/ops/security-ops.js';

const handlers = {
  merge: ({ files }) => mergePdfs(files),
  organize: ({ files, plan }) => organizePdf(files, plan),
  extractPages: ({ bytes, pageIndices, separateFiles }) => extractPages(bytes, pageIndices, { separateFiles }),
  deletePages: ({ bytes, pageIndices }) => deletePages(bytes, pageIndices),
  split: ({ bytes, options }) => splitPdf(bytes, options),
  rotate: ({ bytes, options }) => rotatePages(bytes, options),
  nup: ({ bytes, options }) => nupPdf(bytes, options),
  booklet: ({ bytes }) => bookletPdf(bytes),
  splitHalf: ({ bytes, options }) => splitHalfOrPosterPdf(bytes, options),
  watermark: ({ bytes, options }) => addWatermark(bytes, options),
  pageNumbers: ({ bytes, options }) => addPageNumbers(bytes, options),
  overlay: ({ baseBytes, overlayBytes, options }) => overlayPdf(baseBytes, overlayBytes, options),
  crop: ({ bytes, options }) => cropPdf(bytes, options),
  resize: ({ bytes, options }) => resizePdf(bytes, options),
  applyVisualEdits: ({ bytes, edits }) => applyVisualEdits(bytes, edits),
  inspectForm: ({ bytes }) => inspectFormFields(bytes),
  fillForm: ({ bytes, valuesMap, flatten }) => fillFormFields(bytes, valuesMap, { flatten }),
  setBookmarks: ({ bytes, items }) => setBookmarks(bytes, items),
  inspectInfo: ({ bytes }) => inspectPdfInfo(bytes),
  writeMetadata: ({ bytes, metadata }) => writeMetadata(bytes, metadata),
  imagesToPdf: ({ images, options }) => imagesToPdf(images, options),
  textToPdf: ({ text, options }) => textToPdf(text, options),
  zip: ({ entries }) => createZipArchive(entries),
  qrPdf: ({ payload, ecc, pdfOptions }) => {
    const matrix = generateQrData(payload, { ecc });
    return qrToPdf(matrix, pdfOptions);
  },
  extractEmbeddedImages: ({ bytes }) => extractEmbeddedImages(bytes),
  stripMetadata: ({ bytes }) => stripMetadata(bytes),
  compressLossless: ({ bytes }) => compressPdfLossless(bytes),
  rebuildFromImages: ({ imagePages }) => rebuildPdfFromImages(imagePages),
  buildRedactedPdf: ({ bytes, redactedEntries }) => {
    const map = new Map(redactedEntries);
    return buildRedactedPdf(bytes, map);
  },
  flattenAcroForm: ({ bytes }) => flattenAcroForm(bytes),
  protect: ({ bytes, options }) => protectPdf(bytes, options),
  unlock: ({ bytes, password }) => unlockPdf(bytes, password)
};

function collectTransferables(value, set = new Set()) {
  if (!value) return [];
  if (value instanceof Uint8Array && value.buffer instanceof ArrayBuffer) {
    set.add(value.buffer);
  } else if (Array.isArray(value)) {
    for (const item of value) collectTransferables(item, set);
  } else if (typeof value === 'object') {
    for (const v of Object.values(value)) collectTransferables(v, set);
  }
  return Array.from(set);
}

self.addEventListener('message', async (event) => {
  const { id, action, payload } = event.data || {};
  try {
    const fn = handlers[action];
    if (!fn) throw new Error(`Unbekannte Worker-Aktion: ${action}`);
    const result = await fn(payload || {});
    const transfers = collectTransferables(result);
    self.postMessage({ id, ok: true, result }, transfers);
  } catch (err) {
    self.postMessage({
      id,
      ok: false,
      error: err instanceof Error ? err.message : 'Verarbeitungsfehler im PDF-Worker.'
    });
  }
});
