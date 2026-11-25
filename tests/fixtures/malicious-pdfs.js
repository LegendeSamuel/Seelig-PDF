import { PDFDocument, PDFName, PDFString, StandardFonts } from '@cantoo/pdf-lib';

export async function createCleanSamplePdf({ pages = 2, title = 'Seelig Muster', secretLine = null } = {}) {
  const doc = await PDFDocument.create();
  doc.setTitle(title);
  doc.setAuthor('Samuel Seelig');
  doc.setSubject('Testdokument');
  doc.setCreator('Test-Suite');
  const font = await doc.embedFont(StandardFonts.Helvetica);

  for (let i = 1; i <= pages; i++) {
    const p = doc.addPage([595.28, 841.89]);
    p.drawText(`Seelig PDF Testseite ${i}`, { x: 60, y: 760, size: 22, font });
    if (i === 1 && secretLine) {
      p.drawText(secretLine, { x: 60, y: 650, size: 18, font });
    }
  }
  return await doc.save();
}

export async function createAcroFormSamplePdf() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]);
  const form = doc.getForm();
  const nameField = form.createTextField('vollname');
  nameField.setText('Max Mustermann');
  nameField.addToPage(page, { x: 60, y: 700, width: 220, height: 30 });
  const agreeBox = form.createCheckBox('einverstanden');
  agreeBox.addToPage(page, { x: 60, y: 650, width: 20, height: 20 });
  return await doc.save();
}

export async function createXssMetadataPdf() {
  const doc = await PDFDocument.create();
  doc.setTitle('<img src=x onerror="window.__XSS=1">');
  doc.setAuthor('"><script>window.__XSS=2</script>');
  doc.setSubject('javascript:window.__XSS=3');
  doc.setKeywords(['<svg onload=window.__XSS=4>']);
  doc.addPage([400, 400]).drawText('XSS Metadata Probe');
  return await doc.save();
}

export async function createEmbeddedJsPdf() {
  const doc = await PDFDocument.create();
  doc.addPage([400, 400]).drawText('Embedded JS Probe');
  const jsAction = doc.context.obj({
    Type: 'Action',
    S: 'JavaScript',
    JS: PDFString.of('app.alert("PWNED"); window.__XSS = 99;')
  });
  const jsRef = doc.context.register(jsAction);
  doc.catalog.set(PDFName.of('OpenAction'), jsRef);
  return await doc.save();
}

export function createHtmlPolyglotAsPdf() {
  return new TextEncoder().encode('<!DOCTYPE html><html><body><script>window.__XSS=10</script></body></html>');
}

export function createSvgPolyglotAsPng() {
  return new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" onload="window.__XSS=11"><script>window.__XSS=12</script></svg>');
}

export function createPeExecutableAsPdf() {
  const buf = new Uint8Array(64);
  buf[0] = 0x4d; // M
  buf[1] = 0x5a; // Z
  return buf;
}

export function createCorruptPdfBytes() {
  return new TextEncoder().encode('%PDF-1.7\n1 0 obj\n<< /Broken [ [ [ ');
}

export function createMinimalValidPng() {
  // 1x1 white PNG
  return Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
    0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41,
    0x54, 0x08, 0xd7, 0x63, 0xf8, 0xff, 0xff, 0x3f,
    0x00, 0x05, 0xfe, 0x02, 0xfe, 0xdc, 0xcc, 0x59,
    0xe7, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e,
    0x44, 0xae, 0x42, 0x60, 0x82
  ]);
}
