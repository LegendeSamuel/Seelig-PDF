import { clear, el } from '../ui/dom.js';
import { createDropzone } from '../ui/dropzone.js';
import { runWorkerOp } from '../engine/worker-client.js';
import { extractPdfText, renderPdfToImages } from '../engine/pdf-render.js';
import { sanitizeAndConvertImage } from '../engine/image-ops.js';
import { generateQrData } from '../engine/ops/convert.js';
import { parsePageRanges } from '../security/sanitize.js';
import { getPdfPageCount } from '../engine/pdf-render.js';
import {
  attachClearOnInput,
  buildToolShell,
  makeLabeledField,
  makePrimaryButton,
  makeRadioGroup
} from './workspace-helper.js';
import { triggerBlobDownload } from '../ui/result-panel.js';

export function mountConvertTool(tool, ctx) {
  const shell = buildToolShell({
    tool,
    onBack: ctx.goHome,
    onChainToTool: ctx.chainToTool
  });
  const cleanup = () => {};

  if (tool.id === 'images-to-pdf') {
    const dz = createDropzone({
      id: 'img2pdf-files',
      kind: 'image',
      accept: 'image/png,image/jpeg,image/webp,image/gif,image/bmp',
      multiple: true,
      label: 'Bilder (PNG, JPG, WebP, GIF, BMP) auswählen'
    });
    const presetSelect = el(
      'select',
      { id: 'i2p-preset' },
      el('option', { value: 'A4' }, 'DIN A4'),
      el('option', { value: 'A3' }, 'DIN A3'),
      el('option', { value: 'A5' }, 'DIN A5'),
      el('option', { value: 'Letter' }, 'US Letter'),
      el('option', { value: 'Legal' }, 'US Legal'),
      el('option', { value: 'fit' }, 'Exakte Bildgröße')
    );
    let orient = 'auto';
    const orientGroup = makeRadioGroup(
      'Ausrichtung',
      'i2p-orient',
      [
        { value: 'auto', label: 'Automatisch pro Bild' },
        { value: 'portrait', label: 'Hochformat' },
        { value: 'landscape', label: 'Querformat' }
      ],
      orient,
      (v) => { orient = v; }
    );
    const marginIn = el('input', { type: 'number', id: 'i2p-margin', value: '12', min: 0, max: 60 });

    const runBtn = makePrimaryButton('PDF aus Bildern erstellen', () => {
      shell.runTask(runBtn, 'Bilder werden bereinigt und eingebettet …', async () => {
        const files = dz.getFiles();
        if (!files.length) throw new Error('Bitte wähle mindestens ein Bild aus.');
        const cleanImages = [];
        for (const f of files) {
          const targetFormat = f.format === 'jpeg' ? 'jpeg' : 'png';
          const converted = await sanitizeAndConvertImage(f.bytes, { targetFormat, quality: 0.92 });
          cleanImages.push({ format: converted.format, bytes: converted.bytes });
        }
        const out = await runWorkerOp('imagesToPdf', {
          images: cleanImages,
          options: {
            pagePreset: presetSelect.value,
            orientation: orient,
            marginMm: Number(marginIn.value) || 0
          }
        });
        shell.resultPanel.show({
          filename: 'bilder-sammlung.pdf',
          bytes: out,
          summary: `${files.length} Bild(er) EXIF-bereinigt in PDF verpackt.`
        });
      });
    });

    shell.leftPanel.append(dz.element);
    shell.rightPanel.append(
      el('h2', {}, 'Seitenlayout'),
      makeLabeledField('i2p-preset', 'Seitenformat', presetSelect),
      orientGroup,
      makeLabeledField('i2p-margin', 'Seitenrand (mm)', marginIn),
      runBtn
    );
    return { element: shell.root, cleanup };
  }

  if (tool.id === 'pdf-to-images') {
    let format = 'png';
    let dpi = '150';
    const rangeIn = el('input', { type: 'text', id: 'p2i-range', placeholder: 'Leer lassen für alle Seiten (z. B. 1-3)' });
    const dz = createDropzone({ id: 'p2i-file', initialFiles: ctx.initialFiles, label: 'PDF auswählen' });

    const fmtGroup = makeRadioGroup(
      'Zielformat',
      'p2i-fmt',
      [
        { value: 'png', label: 'PNG (verlustfrei, gestochen scharf)' },
        { value: 'jpeg', label: 'JPG (kompakt für Fotos/Scans)' }
      ],
      format,
      (v) => { format = v; }
    );
    const dpiGroup = makeRadioGroup(
      'Auflösung',
      'p2i-dpi',
      [
        { value: '72', label: '72 DPI (Bildschirm)' },
        { value: '150', label: '150 DPI (Standard)' },
        { value: '220', label: '220 DPI (Hoch)' },
        { value: '300', label: '300 DPI (Druck)' }
      ],
      dpi,
      (v) => { dpi = v; }
    );

    const runBtn = makePrimaryButton('Seiten in Bilder umwandeln', () => {
      shell.runTask(runBtn, 'PDF-Seiten werden gerendert …', async ({ setProgress }) => {
        const files = dz.getFiles();
        if (!files.length) throw new Error('Bitte wähle eine PDF-Datei aus.');
        let pageIndices = null;
        if (rangeIn.value.trim()) {
          const total = await getPdfPageCount(files[0].bytes);
          pageIndices = parsePageRanges(rangeIn.value, total);
        }
        const images = await renderPdfToImages(files[0].bytes, {
          format,
          dpi: Number(dpi),
          pageIndices,
          onProgress: setProgress
        });

        if (images.length === 1) {
          const ext = format === 'jpeg' ? '.jpg' : '.png';
          shell.resultPanel.show({
            filename: `${files[0].name}-seite-${images[0].pageNumber}${ext}`,
            bytes: images[0].bytes,
            mime: format === 'jpeg' ? 'image/jpeg' : 'image/png',
            ext,
            chainable: false,
            summary: `1 Seite (${images[0].width} × ${images[0].height} px) exportiert.`
          });
        } else {
          const ext = format === 'jpeg' ? 'jpg' : 'png';
          const zipBytes = await runWorkerOp('zip', {
            entries: images.map((im) => ({
              name: `seite-${String(im.pageNumber).padStart(3, '0')}.${ext}`,
              bytes: im.bytes
            }))
          });
          shell.resultPanel.show({
            filename: `${files[0].name}-bilder.zip`,
            bytes: zipBytes,
            mime: 'application/zip',
            ext: '.zip',
            chainable: false,
            summary: `${images.length} Seiten als ${ext.toUpperCase()}-Bilder in ZIP exportiert.`
          });
        }
      });
    });

    shell.leftPanel.append(dz.element);
    shell.rightPanel.append(
      el('h2', {}, 'Export-Einstellungen'),
      fmtGroup,
      dpiGroup,
      makeLabeledField('p2i-range', 'Seitenbereich (optional)', rangeIn),
      runBtn
    );
    return { element: shell.root, cleanup };
  }

  if (tool.id === 'extract-images') {
    const gallery = el('div', { className: 'page-grid' });
    const dz = createDropzone({ id: 'eximg-pdf', initialFiles: ctx.initialFiles, label: 'PDF nach eingebetteten Bildern durchsuchen' });

    const runBtn = makePrimaryButton('Bilder extrahieren', () => {
      shell.runTask(runBtn, 'Eingebettete Bilder werden ausgelesen …', async () => {
        clear(gallery);
        const files = dz.getFiles();
        if (!files.length) throw new Error('Bitte wähle eine PDF-Datei aus.');
        const imgs = await runWorkerOp('extractEmbeddedImages', { bytes: files[0].bytes });
        if (!imgs.length) {
          throw new Error('Keine eingebetteten JPEG-Bildströme direkt gefunden. Nutze alternativ „PDF in Bilder“ für ein Seiten-Rendering.');
        }

        imgs.forEach((im) => {
          const blobUrl = URL.createObjectURL(new Blob([im.bytes], { type: 'image/jpeg' }));
          const imgEl = el('img', { src: blobUrl, alt: im.name, style: 'max-width:100%;height:auto;border-radius:6px;' });
          imgEl.addEventListener('load', () => URL.revokeObjectURL(blobUrl), { once: true });
          gallery.appendChild(
            el(
              'div',
              { className: 'page-thumb' },
              imgEl,
              el('span', { className: 'caption-copy' }, `${im.name} (${im.width}×${im.height})`)
            )
          );
        });

        const zipBytes = await runWorkerOp('zip', {
          entries: imgs.map((im) => ({ name: im.name, bytes: im.bytes }))
        });
        shell.resultPanel.show({
          filename: `${files[0].name}-extrahierte-bilder.zip`,
          bytes: zipBytes,
          mime: 'application/zip',
          ext: '.zip',
          chainable: false,
          summary: `${imgs.length} eingebettete(s) Bild(er) extrahiert.`
        });
      });
    });

    shell.leftPanel.append(dz.element, gallery);
    shell.rightPanel.append(el('h2', {}, 'Bild-Extraktion'), el('p', { className: 'muted-copy' }, 'Extrahiert eingebettete Original-JPEG-Bildströme verlustfrei aus dem PDF-Dokument.'), runBtn);
    return { element: shell.root, cleanup };
  }

  if (tool.id === 'extract-text') {
    let fmt = 'txt';
    const outBox = el('textarea', { id: 'ext-txt-preview', readonly: true, rows: 12 });
    const dz = createDropzone({ id: 'ext-txt-pdf', initialFiles: ctx.initialFiles, label: 'PDF zum Text-Auslesen wählen' });
    const fmtGroup = makeRadioGroup(
      'Ausgabeformat',
      'ext-txt-fmt',
      [
        { value: 'txt', label: 'Reiner Text (.txt)' },
        { value: 'md', label: 'Markdown mit Seitenüberschriften (.md)' }
      ],
      fmt,
      (v) => { fmt = v; }
    );

    const runBtn = makePrimaryButton('Text extrahieren', () => {
      shell.runTask(runBtn, 'Text wird sicher ohne Skript-Ausführung gelesen …', async ({ setProgress }) => {
        const files = dz.getFiles();
        if (!files.length) throw new Error('Bitte wähle eine PDF-Datei aus.');
        const res = await extractPdfText(files[0].bytes, { markdown: fmt === 'md', onProgress: setProgress });
        outBox.value = res.text;
        const encoded = new TextEncoder().encode(res.text);
        const ext = fmt === 'md' ? '.md' : '.txt';
        shell.resultPanel.show({
          filename: `${files[0].name}${ext}`,
          bytes: encoded,
          mime: fmt === 'md' ? 'text/markdown;charset=utf-8' : 'text/plain;charset=utf-8',
          ext,
          chainable: false,
          summary: `Text aus ${res.pageCount} Seite(n) extrahiert.`
        });
      });
    });

    shell.leftPanel.append(dz.element, makeLabeledField('ext-txt-preview', 'Extrahierter Text', outBox));
    shell.rightPanel.append(el('h2', {}, 'Export'), fmtGroup, runBtn);
    return { element: shell.root, cleanup };
  }

  if (tool.id === 'text-to-pdf') {
    const textArea = el('textarea', {
      id: 't2p-text',
      rows: 14,
      placeholder: '# Überschrift\n\nHier steht dein Text oder Markdown …'
    });
    attachClearOnInput(textArea);
    const titleIn = el('input', { type: 'text', id: 't2p-title', placeholder: 'Optionaler Dokumenttitel' });
    const sizeIn = el('input', { type: 'number', id: 't2p-size', value: '11', min: 8, max: 20 });
    const mdCheck = el('input', { type: 'checkbox', id: 't2p-md', checked: true });

    const dz = createDropzone({
      id: 't2p-file',
      kind: 'text',
      accept: '.txt,.md,text/plain,text/markdown',
      label: 'Optional: .txt oder .md Datei laden',
      onFilesChange: (files) => {
        if (files.length) textArea.value = files[0].text;
      }
    });

    const runBtn = makePrimaryButton('PDF erzeugen', () => {
      shell.runTask(runBtn, 'PDF-Dokument wird gesetzt …', async () => {
        if (!textArea.value.trim()) {
          textArea.setAttribute('aria-invalid', 'true');
          textArea.focus();
          throw new Error('Bitte gib Text ein oder lade eine Text-/Markdown-Datei.');
        }
        const out = await runWorkerOp('textToPdf', {
          text: textArea.value,
          options: {
            markdown: mdCheck.checked,
            fontSize: Number(sizeIn.value) || 11,
            title: titleIn.value
          }
        });
        shell.resultPanel.show({
          filename: `${titleIn.value || 'text-dokument'}.pdf`,
          bytes: out,
          summary: 'Text sauber als A4-PDF gesetzt.'
        });
      });
    });

    shell.leftPanel.append(dz.element, makeLabeledField('t2p-text', 'Text oder Markdown', textArea));
    shell.rightPanel.append(
      el('h2', {}, 'Satz-Optionen'),
      makeLabeledField('t2p-title', 'Dokumenttitel', titleIn),
      makeLabeledField('t2p-size', 'Schriftgröße (pt)', sizeIn),
      el('label', { htmlFor: 't2p-md', className: 'choice-row' }, mdCheck, 'Markdown-Überschriften (#, ##, ###) & Listen (-) formatieren'),
      runBtn
    );
    return { element: shell.root, cleanup };
  }

  if (tool.id === 'image-convert') {
    let targetFormat = 'webp';
    const dz = createDropzone({
      id: 'imgconv-files',
      kind: 'image',
      accept: 'image/png,image/jpeg,image/webp,image/gif,image/bmp',
      multiple: true,
      label: 'Bilder (PNG, JPG, WebP, GIF, BMP) auswählen'
    });
    const fmtGroup = makeRadioGroup(
      'Zielformat',
      'imgconv-fmt',
      [
        { value: 'webp', label: 'WebP (sehr kompakt)' },
        { value: 'jpeg', label: 'JPG (kompatibel)' },
        { value: 'png', label: 'PNG (verlustfrei)' }
      ],
      targetFormat,
      (v) => { targetFormat = v; }
    );
    const qualIn = el('input', { type: 'range', id: 'imgconv-q', min: 10, max: 100, value: '85' });
    const qualVal = el('span', { className: 'muted-copy' }, '85 %');
    qualIn.addEventListener('input', () => { qualVal.textContent = `${qualIn.value} %`; });
    const maxWIn = el('input', { type: 'number', id: 'imgconv-maxw', value: '2400', min: 64, max: 4096 });

    const runBtn = makePrimaryButton('Bilder konvertieren', () => {
      shell.runTask(runBtn, 'Bilder werden EXIF-frei neu kodiert …', async () => {
        const files = dz.getFiles();
        if (!files.length) throw new Error('Bitte wähle mindestens ein Bild aus.');
        const outEntries = [];
        const ext = targetFormat === 'jpeg' ? 'jpg' : targetFormat;
        for (const f of files) {
          const conv = await sanitizeAndConvertImage(f.bytes, {
            targetFormat,
            quality: Number(qualIn.value) / 100,
            maxWidth: Number(maxWIn.value) || 2400
          });
          outEntries.push({
            name: `${f.name.replace(/\.[^.]+$/, '')}.${ext}`,
            bytes: conv.bytes,
            origLen: f.bytes.byteLength
          });
        }

        if (outEntries.length === 1) {
          const mime = targetFormat === 'jpeg' ? 'image/jpeg' : targetFormat === 'webp' ? 'image/webp' : 'image/png';
          shell.resultPanel.show({
            filename: outEntries[0].name,
            bytes: outEntries[0].bytes,
            originalBytesLen: outEntries[0].origLen,
            mime,
            ext: `.${ext}`,
            chainable: false,
            summary: 'Bild ohne EXIF-Metadaten konvertiert.'
          });
        } else {
          const zipBytes = await runWorkerOp('zip', {
            entries: outEntries.map((e) => ({ name: e.name, bytes: e.bytes }))
          });
          shell.resultPanel.show({
            filename: 'bilder-konvertiert.zip',
            bytes: zipBytes,
            mime: 'application/zip',
            ext: '.zip',
            chainable: false,
            summary: `${outEntries.length} Bilder EXIF-bereinigt konvertiert.`
          });
        }
      });
    });

    shell.leftPanel.append(dz.element);
    shell.rightPanel.append(
      el('h2', {}, 'Komprimierung & Format'),
      fmtGroup,
      makeLabeledField('imgconv-q', 'Qualität (JPG/WebP)', el('div', { className: 'range-row' }, qualIn, qualVal)),
      makeLabeledField('imgconv-maxw', 'Maximale Breite (px)', maxWIn),
      runBtn
    );
    return { element: shell.root, cleanup };
  }

  // qr-code
  let ecc = 'M';
  const payloadIn = el('input', { type: 'text', id: 'qr-payload', value: 'https://seelig-designs.eu' });
  attachClearOnInput(payloadIn);
  const fgIn = el('input', { type: 'color', id: 'qr-fg', value: '#121212' });
  const bgIn = el('input', { type: 'color', id: 'qr-bg', value: '#ffffff' });
  const previewCanvas = el('canvas', { width: 260, height: 260, style: 'background:#ffffff;border-radius:10px;max-width:260px;' });
  const optPdfDz = createDropzone({
    id: 'qr-target-pdf',
    initialFiles: ctx.initialFiles,
    label: 'Optional: QR-Code auf bestehende PDF stempeln'
  });

  function drawQrPreview() {
    const val = payloadIn.value.trim();
    if (!val) return null;
    const matrix = generateQrData(val, { ecc });
    const ctx2 = previewCanvas.getContext('2d');
    const n = matrix.size;
    const quiet = 2;
    const total = n + quiet * 2;
    const scale = Math.floor(260 / total);
    previewCanvas.width = total * scale;
    previewCanvas.height = total * scale;
    ctx2.fillStyle = bgIn.value;
    ctx2.fillRect(0, 0, previewCanvas.width, previewCanvas.height);
    ctx2.fillStyle = fgIn.value;
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (matrix.data[r][c]) {
          ctx2.fillRect((c + quiet) * scale, (r + quiet) * scale, scale, scale);
        }
      }
    }
    return matrix;
  }

  payloadIn.addEventListener('input', () => { try { drawQrPreview(); } catch {} });
  fgIn.addEventListener('input', drawQrPreview);
  bgIn.addEventListener('input', drawQrPreview);

  const eccGroup = makeRadioGroup(
    'Fehlerkorrektur',
    'qr-ecc',
    [
      { value: 'L', label: 'Niedrig (7 %)' },
      { value: 'M', label: 'Standard (15 %)' },
      { value: 'Q', label: 'Hoch (25 %)' },
      { value: 'H', label: 'Maximal (30 %)' }
    ],
    ecc,
    (v) => { ecc = v; drawQrPreview(); }
  );

  const svgDownloadBtn = el('button', {
    type: 'button',
    className: 'cta-button cta-button--ghost',
    onClick: () => {
      const matrix = generateQrData(payloadIn.value, { ecc });
      const n = matrix.size;
      const svgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svgEl.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      svgEl.setAttribute('viewBox', `0 0 ${n + 4} ${n + 4}`);
      const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      bg.setAttribute('width', String(n + 4));
      bg.setAttribute('height', String(n + 4));
      bg.setAttribute('fill', bgIn.value);
      svgEl.appendChild(bg);
      let d = '';
      for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
          if (matrix.data[r][c]) d += `M${c + 2},${r + 2}h1v1h-1z`;
        }
      }
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', d);
      path.setAttribute('fill', fgIn.value);
      svgEl.appendChild(path);
      const xml = new XMLSerializer().serializeToString(svgEl);
      triggerBlobDownload(new TextEncoder().encode(xml), 'qr-code.svg', 'image/svg+xml');
    }
  }, 'Als SVG laden');

  const runBtn = makePrimaryButton('QR-Code als PDF erstellen', () => {
    shell.runTask(runBtn, 'QR-Code wird in PDF gerendert …', async () => {
      if (!payloadIn.value.trim()) {
        payloadIn.setAttribute('aria-invalid', 'true');
        payloadIn.focus();
        throw new Error('Bitte gib Text oder URL für den QR-Code ein.');
      }
      const targetFiles = optPdfDz.getFiles();
      const out = await runWorkerOp('qrPdf', {
        payload: payloadIn.value,
        ecc,
        pdfOptions: {
          targetPdfBytes: targetFiles.length ? targetFiles[0].bytes : null,
          fgHex: fgIn.value,
          bgHex: bgIn.value
        }
      });
      shell.resultPanel.show({
        filename: targetFiles.length ? `${targetFiles[0].name}-qr.pdf` : 'qr-code.pdf',
        bytes: out,
        summary: targetFiles.length ? 'QR-Code auf Seite 1 eingefügt.' : 'Vektor-QR-Code als A4-PDF erstellt.'
      });
    });
  });

  drawQrPreview();
  shell.leftPanel.append(
    el('h3', {}, 'Live-Vorschau'),
    previewCanvas,
    optPdfDz.element
  );
  shell.rightPanel.append(
    el('h2', {}, 'QR-Code Inhalt'),
    makeLabeledField('qr-payload', 'Text oder URL', payloadIn),
    eccGroup,
    el('div', { className: 'two-col-inputs' }, makeLabeledField('qr-fg', 'Vordergrund', fgIn), makeLabeledField('qr-bg', 'Hintergrund', bgIn)),
    svgDownloadBtn,
    runBtn
  );
  return { element: shell.root, cleanup };
}
