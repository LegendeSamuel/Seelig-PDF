import { PDFDocument, PDFName } from '@cantoo/pdf-lib';
import { loadPdfSafe } from './organize.js';
import { inspectPdfInfo } from './edit.js';

export async function stripMetadata(bytes) {
  const before = await inspectPdfInfo(bytes);
  const doc = await loadPdfSafe(bytes);

  doc.setTitle('');
  doc.setAuthor('');
  doc.setSubject('');
  doc.setKeywords([]);
  doc.setCreator('');
  doc.setProducer('');
  doc.catalog.delete(PDFName.of('Metadata'));
  if (doc.context.trailerInfo.Info) {
    doc.context.delete(doc.context.trailerInfo.Info);
    delete doc.context.trailerInfo.Info;
  }

  const outBytes = await doc.save({ useObjectStreams: true, updateFieldAppearances: false });
  // Ensure save didn't auto-repopulate non-empty creator/producer in info dict
  const cleanDoc = await PDFDocument.load(outBytes, { updateMetadata: false });
  if (cleanDoc.context.trailerInfo.Info) {
    cleanDoc.context.delete(cleanDoc.context.trailerInfo.Info);
    delete cleanDoc.context.trailerInfo.Info;
  }
  cleanDoc.catalog.delete(PDFName.of('Metadata'));
  const finalBytes = await cleanDoc.save({ useObjectStreams: true });
  const after = await inspectPdfInfo(finalBytes);

  return { bytes: finalBytes, before, after };
}

export async function compressPdfLossless(bytes) {
  const { bytes: stripped } = await stripMetadata(bytes);
  const src = await loadPdfSafe(stripped);
  const fresh = await PDFDocument.create();
  const copied = await fresh.copyPages(src, src.getPageIndices());
  for (const p of copied) fresh.addPage(p);
  return await fresh.save({ useObjectStreams: true });
}

export async function rebuildPdfFromImages(imagePages) {
  const out = await PDFDocument.create();
  for (const item of imagePages) {
    const img = item.format === 'jpeg'
      ? await out.embedJpg(item.bytes)
      : await out.embedPng(item.bytes);
    const pageW = item.ptWidth || (item.width * 72) / 150;
    const pageH = item.ptHeight || (item.height * 72) / 150;
    const page = out.addPage([pageW, pageH]);
    page.drawImage(img, { x: 0, y: 0, width: pageW, height: pageH });
  }
  return await out.save({ useObjectStreams: true });
}

export async function buildRedactedPdf(origBytes, redactedPageImagesMap) {
  const src = await loadPdfSafe(origBytes);
  const out = await PDFDocument.create();
  const count = src.getPageCount();

  for (let idx = 0; idx < count; idx++) {
    const pageNum = idx + 1;
    const replacement = redactedPageImagesMap.get(pageNum);
    if (replacement) {
      const origSize = src.getPage(idx).getSize();
      const img = replacement.format === 'jpeg'
        ? await out.embedJpg(replacement.bytes)
        : await out.embedPng(replacement.bytes);
      const page = out.addPage([origSize.width, origSize.height]);
      page.drawImage(img, { x: 0, y: 0, width: origSize.width, height: origSize.height });
    } else {
      const [copied] = await out.copyPages(src, [idx]);
      out.addPage(copied);
    }
  }
  return await out.save({ useObjectStreams: true });
}

export async function flattenAcroForm(bytes) {
  const doc = await loadPdfSafe(bytes);
  try {
    doc.getForm().flatten();
  } catch {
    // Document may not contain any AcroForm
  }
  return await doc.save({ useObjectStreams: true });
}

export async function protectPdf(bytes, {
  userPassword = '',
  ownerPassword = '',
  permissions = {}
} = {}) {
  if (!userPassword && !ownerPassword) {
    throw new Error('Bitte gib mindestens ein Öffnen- oder Besitzer-Passwort an.');
  }
  const doc = await loadPdfSafe(bytes);
  doc.encrypt({
    userPassword: String(userPassword || ''),
    ownerPassword: String(ownerPassword || userPassword || ''),
    algorithm: 'AES-256',
    permissions: {
      printing: permissions.printing === false ? false : 'highResolution',
      modifying: Boolean(permissions.modifying),
      copying: Boolean(permissions.copying),
      annotating: Boolean(permissions.annotating),
      fillingForms: permissions.fillingForms !== false,
      contentAccessibility: true,
      documentAssembly: Boolean(permissions.documentAssembly)
    }
  });
  return await doc.save({ useObjectStreams: false });
}

export async function unlockPdf(bytes, password) {
  if (!password) {
    throw new Error('Bitte gib das aktuelle Passwort der PDF-Datei ein.');
  }
  let src;
  try {
    src = await PDFDocument.load(bytes, { password: String(password), updateMetadata: false });
  } catch {
    throw new Error('Entschlüsselung fehlgeschlagen. Prüfe das Passwort oder ob ein unterstütztes Verfahren vorliegt.');
  }
  const out = await PDFDocument.create();
  const copied = await out.copyPages(src, src.getPageIndices());
  for (const p of copied) out.addPage(p);
  return await out.save({ useObjectStreams: true });
}
