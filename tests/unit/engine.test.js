import { describe, expect, it } from 'vitest';
import { PDFDocument } from '@cantoo/pdf-lib';
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
} from '../../src/engine/ops/organize.js';
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
} from '../../src/engine/ops/edit.js';
import {
  createZipArchive,
  generateQrData,
  imagesToPdf,
  qrToPdf,
  textToPdf
} from '../../src/engine/ops/convert.js';
import {
  compressPdfLossless,
  flattenAcroForm,
  protectPdf,
  stripMetadata,
  unlockPdf
} from '../../src/engine/ops/security-ops.js';
import {
  createAcroFormSamplePdf,
  createCleanSamplePdf,
  createEmbeddedJsPdf,
  createMinimalValidPng,
  createXssMetadataPdf
} from '../fixtures/malicious-pdfs.js';

describe('PDF Engine Operations & Adversarial Robustness', () => {
  it('merges, splits, organizes, deletes, extracts, rotates, n-up, booklet, and half-splits', async () => {
    const a = await createCleanSamplePdf({ pages: 2 });
    const b = await createCleanSamplePdf({ pages: 3 });

    const merged = await mergePdfs([a, b]);
    expect((await PDFDocument.load(merged)).getPageCount()).toBe(5);

    const splitAll = await splitPdf(merged, { mode: 'all' });
    expect(splitAll).toHaveLength(5);

    const org = await organizePdf([a, b], [
      { fileIndex: 1, pageIndex: 2, rotateDeg: 90 },
      { fileIndex: 0, pageIndex: 0, rotateDeg: 0 }
    ]);
    const orgDoc = await PDFDocument.load(org);
    expect(orgDoc.getPageCount()).toBe(2);
    expect(orgDoc.getPage(0).getRotation().angle).toBe(90);

    const deleted = await deletePages(merged, [0, 2]);
    expect((await PDFDocument.load(deleted)).getPageCount()).toBe(3);

    const extracted = await extractPages(merged, [1, 4], { separateFiles: false });
    expect((await PDFDocument.load(extracted[0].bytes)).getPageCount()).toBe(2);

    const rotated = await rotatePages(a, { angleDeg: 180 });
    expect((await PDFDocument.load(rotated)).getPage(0).getRotation().angle).toBe(180);

    const nup = await nupPdf(merged, { perSheet: 4, landscape: true, border: true });
    expect((await PDFDocument.load(nup)).getPageCount()).toBe(2);

    const booklet = await bookletPdf(merged);
    expect((await PDFDocument.load(booklet)).getPageCount()).toBe(4);

    const halved = await splitHalfOrPosterPdf(a, { mode: 'vertical' });
    expect((await PDFDocument.load(halved)).getPageCount()).toBe(4);
  });

  it('watermarks, numbers, overlays, crops, resizes, visually edits, sets bookmarks, and edits metadata', async () => {
    const a = await createCleanSamplePdf({ pages: 2 });
    const b = await createCleanSamplePdf({ pages: 1 });

    const wm = await addWatermark(a, { text: 'SEELIG', tile: true });
    expect((await PDFDocument.load(wm)).getPageCount()).toBe(2);

    const num = await addPageNumbers(a, { position: 'bottom-right', format: '{n}/{total}' });
    expect((await PDFDocument.load(num)).getPageCount()).toBe(2);

    const ov = await overlayPdf(a, b, { placement: 'background', repeatSingleOverlay: true });
    expect((await PDFDocument.load(ov)).getPageCount()).toBe(2);

    const cropped = await cropPdf(a, { topMm: 10, rightMm: 10, bottomMm: 10, leftMm: 10 });
    const cropBox = (await PDFDocument.load(cropped)).getPage(0).getCropBox();
    expect(cropBox.width).toBeLessThan(595);

    const resized = await resizePdf(a, { preset: 'A3', orientation: 'landscape' });
    const resSize = (await PDFDocument.load(resized)).getPage(0).getSize();
    expect(Math.round(resSize.width)).toBe(1191);

    const edited = await applyVisualEdits(a, [
      { type: 'text', pageNumber: 1, x: 0.1, y: 0.1, text: 'Notiz', fontSize: 14 },
      { type: 'highlight', pageNumber: 1, x: 0.2, y: 0.2, w: 0.3, h: 0.05 },
      { type: 'image', pageNumber: 1, x: 0.5, y: 0.5, w: 0.2, h: 0.1, imageBytes: createMinimalValidPng(), imageType: 'png' }
    ]);
    expect((await PDFDocument.load(edited)).getPageCount()).toBe(2);

    const bookmarked = await setBookmarks(a, [{ title: 'Start', pageNumber: 1 }, { title: 'Ende', pageNumber: 2 }]);
    const infoBm = await inspectPdfInfo(bookmarked);
    expect(infoBm.hasOutlines).toBe(true);

    const metaUpdated = await writeMetadata(a, { title: 'Neuer Titel', author: 'Samuel' });
    const infoMeta = await inspectPdfInfo(metaUpdated);
    expect(infoMeta.metadata.title).toBe('Neuer Titel');
  });

  it('fills and flattens AcroForms cleanly', async () => {
    const formPdf = await createAcroFormSamplePdf();
    const fields = await inspectFormFields(formPdf);
    expect(fields.map((f) => f.name)).toContain('vollname');

    const filled = await fillFormFields(formPdf, { vollname: 'Samuel Seelig', einverstanden: true }, { flatten: true });
    const afterFields = await inspectFormFields(filled);
    expect(afterFields).toHaveLength(0);

    const flatOnly = await flattenAcroForm(formPdf);
    expect((await inspectFormFields(flatOnly))).toHaveLength(0);
  });

  it('converts images, text/markdown, QR codes, and zips', async () => {
    const imgPdf = await imagesToPdf([{ format: 'png', bytes: createMinimalValidPng() }]);
    expect((await PDFDocument.load(imgPdf)).getPageCount()).toBe(1);

    const txtPdf = await textToPdf('# Titel\n\n- Punkt Eins\n- Punkt Zwei\n\nAbsatz.', { markdown: true, title: 'Notiz' });
    expect((await PDFDocument.load(txtPdf)).getPageCount()).toBe(1);

    const qr = generateQrData('https://pdf.seelig-designs.eu');
    const qrPdfBytes = await qrToPdf(qr);
    expect((await PDFDocument.load(qrPdfBytes)).getPageCount()).toBe(1);

    const zip = createZipArchive([{ name: 'a.pdf', bytes: imgPdf }, { name: 'b.pdf', bytes: txtPdf }]);
    expect(zip[0]).toBe(0x50); // P
    expect(zip[1]).toBe(0x4b); // K
  });

  it('encrypts with AES-256, unlocks with password, strips metadata, and detects adversarial JS tokens', async () => {
    const sample = await createCleanSamplePdf({ pages: 1, title: 'Geheim' });
    const protectedBytes = await protectPdf(sample, { userPassword: 'TestPassword!99', ownerPassword: 'Owner!99' });

    await expect(PDFDocument.load(protectedBytes)).rejects.toThrow();

    const unlocked = await unlockPdf(protectedBytes, 'TestPassword!99');
    expect(Buffer.from(unlocked).includes('/Encrypt')).toBe(false);
    expect((await PDFDocument.load(unlocked)).getPageCount()).toBe(1);

    const { bytes: stripped, after } = await stripMetadata(sample);
    expect(after.metadata.title).toBe('');
    expect(after.metadata.author).toBe('');
    expect(after.hasXmpMetadata).toBe(false);

    const lossless = await compressPdfLossless(sample);
    expect((await PDFDocument.load(lossless)).getPageCount()).toBe(1);

    const jsPdf = await createEmbeddedJsPdf();
    const jsInfo = await inspectPdfInfo(jsPdf);
    expect(jsInfo.hasActiveScriptTokens).toBe(true);

    const xssPdf = await createXssMetadataPdf();
    const xssInfo = await inspectPdfInfo(xssPdf);
    expect(xssInfo.metadata.title).toContain('<img');
  });
});
