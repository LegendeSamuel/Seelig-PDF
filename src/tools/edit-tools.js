import { clear, el } from '../ui/dom.js';
import { createDropzone } from '../ui/dropzone.js';
import { createInteractivePdfStage, createSignaturePad } from '../ui/canvas-editor.js';
import { runWorkerOp } from '../engine/worker-client.js';
import { sanitizeAndConvertImage } from '../engine/image-ops.js';
import { sanitizeDisplayText } from '../security/sanitize.js';
import {
  attachClearOnInput,
  buildToolShell,
  makeLabeledField,
  makePrimaryButton,
  makeRadioGroup
} from './workspace-helper.js';

export function mountEditTool(tool, ctx) {
  const shell = buildToolShell({
    tool,
    onBack: ctx.goHome,
    onChainToTool: ctx.chainToTool
  });
  let stageCleanup = null;
  const cleanup = () => {
    if (stageCleanup) stageCleanup();
  };

  if (tool.id === 'watermark') {
    let wmType = 'text';
    const pdfDz = createDropzone({ id: 'wm-pdf', initialFiles: ctx.initialFiles, label: 'PDF auswählen' });
    const imgDz = createDropzone({ id: 'wm-img', kind: 'image', accept: 'image/png,image/jpeg,image/webp', label: 'Wasserzeichen-Bild (PNG/JPG)' });
    imgDz.element.hidden = true;

    const textIn = el('input', { type: 'text', id: 'wm-text', value: 'VERTRAULICH' });
    const angleIn = el('input', { type: 'number', id: 'wm-angle', value: '45', min: -180, max: 180 });
    const sizeIn = el('input', { type: 'number', id: 'wm-size', value: '48', min: 10, max: 140 });
    const opacityIn = el('input', { type: 'range', id: 'wm-opacity', min: 5, max: 100, value: '25' });
    const opacityVal = el('span', { className: 'muted-copy' }, '25 %');
    opacityIn.addEventListener('input', () => { opacityVal.textContent = `${opacityIn.value} %`; });
    const colorIn = el('input', { type: 'color', id: 'wm-color', value: '#f2a007' });
    const tileCheck = el('input', { type: 'checkbox', id: 'wm-tile' });

    const textField = makeLabeledField('wm-text', 'Wasserzeichen-Text', textIn);
    const typeGroup = makeRadioGroup(
      'Art des Wasserzeichens',
      'wm-type',
      [
        { value: 'text', label: 'Text-Wasserzeichen' },
        { value: 'image', label: 'Bild-Wasserzeichen' }
      ],
      wmType,
      (v) => {
        wmType = v;
        textField.hidden = v !== 'text';
        imgDz.element.hidden = v !== 'image';
      }
    );

    const runBtn = makePrimaryButton('Wasserzeichen einfügen', () => {
      shell.runTask(runBtn, 'Wasserzeichen wird eingebettet …', async () => {
        const files = pdfDz.getFiles();
        if (!files.length) throw new Error('Bitte wähle eine PDF-Datei aus.');
        const options = {
          opacity: Number(opacityIn.value) / 100,
          angleDeg: Number(angleIn.value),
          fontSize: Number(sizeIn.value),
          colorHex: colorIn.value,
          tile: tileCheck.checked
        };
        if (wmType === 'image') {
          const imgs = imgDz.getFiles();
          if (!imgs.length) throw new Error('Bitte wähle ein Bild für das Wasserzeichen aus.');
          const cleanImg = await sanitizeAndConvertImage(imgs[0].bytes, {
            targetFormat: imgs[0].format === 'jpeg' ? 'jpeg' : 'png'
          });
          options.imageBytes = cleanImg.bytes;
          options.imageType = cleanImg.format;
        } else {
          options.text = textIn.value;
        }

        const out = await runWorkerOp('watermark', { bytes: files[0].bytes, options });
        shell.resultPanel.show({
          filename: `${files[0].name}-wasserzeichen.pdf`,
          bytes: out,
          originalBytesLen: files[0].bytes.byteLength,
          summary: 'Wasserzeichen auf alle Seiten angewendet.'
        });
      });
    });

    shell.leftPanel.append(pdfDz.element);
    shell.rightPanel.append(
      el('h2', {}, 'Wasserzeichen'),
      typeGroup,
      textField,
      imgDz.element,
      el('div', { className: 'two-col-inputs' }, makeLabeledField('wm-angle', 'Winkel (°)', angleIn), makeLabeledField('wm-size', 'Schriftgröße', sizeIn)),
      makeLabeledField('wm-opacity', 'Deckkraft', el('div', { className: 'range-row' }, opacityIn, opacityVal)),
      makeLabeledField('wm-color', 'Farbe', colorIn),
      el('label', { htmlFor: 'wm-tile', className: 'choice-row' }, tileCheck, 'Als Kachelmuster über gesamte Seite verteilen'),
      runBtn
    );
    return { element: shell.root, cleanup };
  }

  if (tool.id === 'page-numbers') {
    const dz = createDropzone({ id: 'pn-pdf', initialFiles: ctx.initialFiles, label: 'PDF auswählen' });
    const posSelect = el(
      'select',
      { id: 'pn-pos' },
      el('option', { value: 'bottom-center' }, 'Unten mittig'),
      el('option', { value: 'bottom-right' }, 'Unten rechts'),
      el('option', { value: 'bottom-left' }, 'Unten links'),
      el('option', { value: 'top-center' }, 'Oben mittig'),
      el('option', { value: 'top-right' }, 'Oben rechts'),
      el('option', { value: 'top-left' }, 'Oben links')
    );
    const fmtIn = el('input', { type: 'text', id: 'pn-fmt', value: '{n} / {total}' });
    const startIn = el('input', { type: 'number', id: 'pn-start', value: '1', min: 1 });
    const sizeIn = el('input', { type: 'number', id: 'pn-size', value: '11', min: 7, max: 32 });
    const colorIn = el('input', { type: 'color', id: 'pn-color', value: '#333333' });
    const skipCheck = el('input', { type: 'checkbox', id: 'pn-skip' });

    const runBtn = makePrimaryButton('Seitenzahlen einfügen', () => {
      shell.runTask(runBtn, 'Seitenzahlen werden ergänzt …', async () => {
        const files = dz.getFiles();
        if (!files.length) throw new Error('Bitte wähle eine PDF-Datei aus.');
        const out = await runWorkerOp('pageNumbers', {
          bytes: files[0].bytes,
          options: {
            position: posSelect.value,
            format: fmtIn.value,
            startNumber: Number(startIn.value) || 1,
            fontSize: Number(sizeIn.value) || 11,
            colorHex: colorIn.value,
            skipFirstPage: skipCheck.checked
          }
        });
        shell.resultPanel.show({
          filename: `${files[0].name}-nummeriert.pdf`,
          bytes: out,
          originalBytesLen: files[0].bytes.byteLength,
          summary: 'Seitenzahlen eingefügt.'
        });
      });
    });

    shell.leftPanel.append(dz.element);
    shell.rightPanel.append(
      el('h2', {}, 'Nummerierung'),
      makeLabeledField('pn-pos', 'Position', posSelect),
      makeLabeledField('pn-fmt', 'Formatvorlage', fmtIn, 'Platzhalter: {n} = Seite, {total} = Gesamtseiten'),
      el('div', { className: 'two-col-inputs' }, makeLabeledField('pn-start', 'Startnummer', startIn), makeLabeledField('pn-size', 'Schriftgröße', sizeIn)),
      makeLabeledField('pn-color', 'Textfarbe', colorIn),
      el('label', { htmlFor: 'pn-skip', className: 'choice-row' }, skipCheck, 'Erste Seite (Deckblatt) überspringen'),
      runBtn
    );
    return { element: shell.root, cleanup };
  }

  if (tool.id === 'overlay') {
    let placement = 'background';
    const baseDz = createDropzone({ id: 'ov-base', initialFiles: ctx.initialFiles, label: '1. Basis-Dokument (PDF)' });
    const overDz = createDropzone({ id: 'ov-over', label: '2. Briefpapier / Stempel-PDF' });
    const repeatCheck = el('input', { type: 'checkbox', id: 'ov-repeat', checked: true });
    const placeGroup = makeRadioGroup(
      'Ebene des Overlays',
      'ov-place',
      [
        { value: 'background', label: 'Als Hintergrund (Briefpapier)' },
        { value: 'foreground', label: 'Im Vordergrund (Stempel/Kopf)' }
      ],
      placement,
      (v) => { placement = v; }
    );

    const runBtn = makePrimaryButton('PDFs übereinanderlegen', () => {
      shell.runTask(runBtn, 'Dokumente werden kombiniert …', async () => {
        const b = baseDz.getFiles();
        const o = overDz.getFiles();
        if (!b.length || !o.length) throw new Error('Bitte lade sowohl Basis- als auch Overlay-PDF hoch.');
        const out = await runWorkerOp('overlay', {
          baseBytes: b[0].bytes,
          overlayBytes: o[0].bytes,
          options: { placement, repeatSingleOverlay: repeatCheck.checked }
        });
        shell.resultPanel.show({
          filename: `${b[0].name}-overlay.pdf`,
          bytes: out,
          originalBytesLen: b[0].bytes.byteLength,
          summary: 'Beide PDFs sauber übereinandergelegt.'
        });
      });
    });

    shell.leftPanel.append(baseDz.element, overDz.element);
    shell.rightPanel.append(
      el('h2', {}, 'Überlagerung'),
      placeGroup,
      el('label', { htmlFor: 'ov-repeat', className: 'choice-row' }, repeatCheck, 'Einseitiges Overlay auf alle Seiten anwenden'),
      runBtn
    );
    return { element: shell.root, cleanup };
  }

  if (tool.id === 'crop') {
    const topIn = el('input', { type: 'number', id: 'crop-top', value: '10', min: 0, max: 200 });
    const rightIn = el('input', { type: 'number', id: 'crop-right', value: '10', min: 0, max: 200 });
    const bottomIn = el('input', { type: 'number', id: 'crop-bottom', value: '10', min: 0, max: 200 });
    const leftIn = el('input', { type: 'number', id: 'crop-left', value: '10', min: 0, max: 200 });
    let scope = 'all';

    const stage = createInteractivePdfStage({
      mode: 'crop',
      boxClass: 'stage-box--crop',
      onBoxesChange: (boxes) => {
        if (!boxes.length) return;
        const b = boxes[0];
        // Approximate A4 (210x297mm) proportional margins from interactive rectangle
        leftIn.value = String(Math.round(b.x * 210));
        rightIn.value = String(Math.round((1 - (b.x + b.w)) * 210));
        topIn.value = String(Math.round(b.y * 297));
        bottomIn.value = String(Math.round((1 - (b.y + b.h)) * 297));
      }
    });
    stageCleanup = stage.cleanup;

    const dz = createDropzone({
      id: 'crop-file',
      initialFiles: ctx.initialFiles,
      label: 'PDF zum Beschneiden wählen',
      onFilesChange: (files) => {
        if (files.length) stage.loadPdf(files[0].bytes).catch((e) => shell.setError(e.message));
      }
    });
    if (ctx.initialFiles.length) dz.setFiles(ctx.initialFiles);

    const scopeGroup = makeRadioGroup(
      'Anwenden auf',
      'crop-scope',
      [
        { value: 'all', label: 'Alle Seiten' },
        { value: 'current', label: 'Nur angezeigte Seite' }
      ],
      scope,
      (v) => { scope = v; }
    );

    const runBtn = makePrimaryButton('PDF beschneiden', () => {
      shell.runTask(runBtn, 'Ränder werden zugeschnitten …', async () => {
        const files = dz.getFiles();
        if (!files.length) throw new Error('Bitte lade zuerst eine PDF-Datei hoch.');
        const out = await runWorkerOp('crop', {
          bytes: files[0].bytes,
          options: {
            topMm: Number(topIn.value) || 0,
            rightMm: Number(rightIn.value) || 0,
            bottomMm: Number(bottomIn.value) || 0,
            leftMm: Number(leftIn.value) || 0,
            pageIndices: scope === 'current' ? [stage.getCurrentPage() - 1] : null
          }
        });
        shell.resultPanel.show({
          filename: `${files[0].name}-beschnitten.pdf`,
          bytes: out,
          originalBytesLen: files[0].bytes.byteLength,
          summary: 'Seitenränder beschnitten.'
        });
      });
    });

    shell.leftPanel.append(dz.element, stage.element);
    shell.rightPanel.append(
      el('h2', {}, 'Ränder abziehen (mm)'),
      el('p', { className: 'muted-copy' }, 'Ziehe einen Rahmen in der Vorschau oder trage exakte Millimeter ein.'),
      el('div', { className: 'two-col-inputs' }, makeLabeledField('crop-top', 'Oben (mm)', topIn), makeLabeledField('crop-bottom', 'Unten (mm)', bottomIn)),
      el('div', { className: 'two-col-inputs' }, makeLabeledField('crop-left', 'Links (mm)', leftIn), makeLabeledField('crop-right', 'Rechts (mm)', rightIn)),
      scopeGroup,
      runBtn
    );
    return { element: shell.root, cleanup };
  }

  if (tool.id === 'resize') {
    const dz = createDropzone({ id: 'resize-file', initialFiles: ctx.initialFiles, label: 'PDF auswählen' });
    const fmtSelect = el(
      'select',
      { id: 'resize-fmt' },
      el('option', { value: 'A4' }, 'DIN A4 (210 × 297 mm)'),
      el('option', { value: 'A3' }, 'DIN A3 (297 × 420 mm)'),
      el('option', { value: 'A5' }, 'DIN A5 (148 × 210 mm)'),
      el('option', { value: 'Letter' }, 'US Letter'),
      el('option', { value: 'Legal' }, 'US Legal'),
      el('option', { value: 'custom' }, 'Benutzerdefiniert (mm)')
    );
    const customW = el('input', { type: 'number', id: 'resize-w', value: '210', min: 40, max: 2000 });
    const customH = el('input', { type: 'number', id: 'resize-h', value: '297', min: 40, max: 2000 });
    const customRow = el('div', { className: 'two-col-inputs', hidden: true }, makeLabeledField('resize-w', 'Breite (mm)', customW), makeLabeledField('resize-h', 'Höhe (mm)', customH));
    fmtSelect.addEventListener('change', () => { customRow.hidden = fmtSelect.value !== 'custom'; });

    let orient = 'portrait';
    const orientGroup = makeRadioGroup(
      'Ausrichtung',
      'resize-orient',
      [
        { value: 'portrait', label: 'Hochformat' },
        { value: 'landscape', label: 'Querformat' }
      ],
      orient,
      (v) => { orient = v; }
    );

    const runBtn = makePrimaryButton('Seitengröße anpassen', () => {
      shell.runTask(runBtn, 'Seitenformat wird skaliert …', async () => {
        const files = dz.getFiles();
        if (!files.length) throw new Error('Bitte wähle eine PDF-Datei aus.');
        const out = await runWorkerOp('resize', {
          bytes: files[0].bytes,
          options: {
            preset: fmtSelect.value,
            orientation: orient,
            customWidthMm: Number(customW.value),
            customHeightMm: Number(customH.value)
          }
        });
        shell.resultPanel.show({
          filename: `${files[0].name}-${fmtSelect.value.toLowerCase()}.pdf`,
          bytes: out,
          originalBytesLen: files[0].bytes.byteLength,
          summary: `Auf Zielformat ${fmtSelect.value} skaliert.`
        });
      });
    });

    shell.leftPanel.append(dz.element);
    shell.rightPanel.append(el('h2', {}, 'Zielformat'), makeLabeledField('resize-fmt', 'Papierformat', fmtSelect), customRow, orientGroup, runBtn);
    return { element: shell.root, cleanup };
  }

  if (tool.id === 'sign' || tool.id === 'annotate') {
    const isSign = tool.id === 'sign';
    const stage = createInteractivePdfStage({
      mode: isSign ? 'sign' : 'annotate',
      boxClass: isSign ? 'stage-box--rect' : 'stage-box--highlight'
    });
    stageCleanup = stage.cleanup;

    const dz = createDropzone({
      id: `${tool.id}-pdf`,
      initialFiles: ctx.initialFiles,
      label: 'PDF auswählen',
      onFilesChange: (files) => {
        if (files.length) stage.loadPdf(files[0].bytes).catch((e) => shell.setError(e.message));
      }
    });
    if (ctx.initialFiles.length) dz.setFiles(ctx.initialFiles);

    let sigPad = null;
    let uploadedSigImg = null;
    let annMode = 'text';
    const annText = el('input', { type: 'text', id: 'ann-text', value: 'Freigegeben' });
    const annSize = el('input', { type: 'number', id: 'ann-size', value: '14', min: 8, max: 72 });
    const annColor = el('input', { type: 'color', id: 'ann-color', value: '#f2a007' });

    if (isSign) {
      sigPad = createSignaturePad();
      const sigImgDz = createDropzone({
        id: 'sign-img-upload',
        kind: 'image',
        accept: 'image/png,image/jpeg,image/webp',
        label: 'Optional: Unterschrift als Bild laden',
        onFilesChange: async (files) => {
          if (!files.length) { uploadedSigImg = null; return; }
          uploadedSigImg = await sanitizeAndConvertImage(files[0].bytes, { targetFormat: 'png' });
        }
      });

      stage.setPayloadProvider(() => ({ kind: 'sign', label: 'Unterschrift' }));

      const runBtn = makePrimaryButton('Unterschrift einbetten', () => {
        shell.runTask(runBtn, 'Unterschrift wird eingebettet …', async () => {
          const files = dz.getFiles();
          if (!files.length) throw new Error('Bitte wähle zuerst eine PDF-Datei aus.');
          let sigBytes = uploadedSigImg?.bytes || (await sigPad.toPngBytes());
          if (!sigBytes) throw new Error('Bitte zeichne deine Unterschrift oder lade ein Signatur-Bild hoch.');
          const boxes = stage.getBoxes();
          if (!boxes.length) {
            throw new Error('Klicke oder ziehe auf der PDF-Vorschau an der gewünschten Position für die Unterschrift.');
          }
          const edits = boxes.map((b) => ({
            type: 'image',
            pageNumber: b.pageNumber,
            x: b.x,
            y: b.y,
            w: b.w,
            h: b.h,
            imageBytes: sigBytes,
            imageType: 'png'
          }));
          const out = await runWorkerOp('applyVisualEdits', { bytes: files[0].bytes, edits });
          shell.resultPanel.show({
            filename: `${files[0].name}-unterschrieben.pdf`,
            bytes: out,
            originalBytesLen: files[0].bytes.byteLength,
            summary: `${edits.length} Unterschrift(en) dauerhaft eingebettet.`
          });
        });
      });

      shell.leftPanel.append(dz.element, stage.element);
      shell.rightPanel.append(
        el('h2', {}, 'Unterschrift zeichnen'),
        sigPad.element,
        el('button', { type: 'button', className: 'cta-button cta-button--ghost', onClick: () => sigPad.reset() }, 'Zeichenfeld leeren'),
        sigImgDz.element,
        el('p', { className: 'muted-copy' }, 'Klicke anschließend auf der Seite links an die Position deiner Unterschrift.'),
        runBtn
      );
      return { element: shell.root, cleanup };
    }

    // Annotate mode
    const modeGroup = makeRadioGroup(
      'Werkzeug',
      'ann-mode',
      [
        { value: 'text', label: 'Text hinzufügen' },
        { value: 'highlight', label: 'Gelb/Amber markieren' },
        { value: 'rect', label: 'Rechteck / Rahmen' }
      ],
      annMode,
      (v) => { annMode = v; }
    );
    stage.setPayloadProvider(() => ({
      kind: annMode,
      text: annText.value,
      fontSize: Number(annSize.value) || 14,
      colorHex: annColor.value,
      label: annMode === 'text' ? `Text: ${annText.value.slice(0, 18)}` : annMode === 'highlight' ? 'Markierung' : 'Rahmen'
    }));

    const runBtn = makePrimaryButton('Änderungen speichern', () => {
      shell.runTask(runBtn, 'Kommentare werden gespeichert …', async () => {
        const files = dz.getFiles();
        if (!files.length) throw new Error('Bitte wähle zuerst eine PDF-Datei aus.');
        const boxes = stage.getBoxes();
        if (!boxes.length) throw new Error('Ziehe mindestens einen Bereich auf der PDF-Vorschau auf.');
        const edits = boxes.map((b) => ({
          type: b.payload.kind,
          pageNumber: b.pageNumber,
          x: b.x,
          y: b.y,
          w: b.w,
          h: b.h,
          text: b.payload.text,
          fontSize: b.payload.fontSize,
          colorHex: b.payload.colorHex
        }));
        const out = await runWorkerOp('applyVisualEdits', { bytes: files[0].bytes, edits });
        shell.resultPanel.show({
          filename: `${files[0].name}-bearbeitet.pdf`,
          bytes: out,
          originalBytesLen: files[0].bytes.byteLength,
          summary: `${edits.length} Element(e) eingefügt.`
        });
      });
    });

    shell.leftPanel.append(dz.element, stage.element);
    shell.rightPanel.append(
      el('h2', {}, 'Kommentare & Text'),
      modeGroup,
      makeLabeledField('ann-text', 'Textinhalt (für Text-Modus)', annText),
      el('div', { className: 'two-col-inputs' }, makeLabeledField('ann-size', 'Schriftgröße', annSize), makeLabeledField('ann-color', 'Farbe', annColor)),
      runBtn
    );
    return { element: shell.root, cleanup };
  }

  if (tool.id === 'fill-form') {
    const fieldsHost = el('div', { className: 'form-stack' });
    const flattenCheck = el('input', { type: 'checkbox', id: 'form-flatten' });
    let loadedFields = [];
    const controlGetters = new Map();

    const dz = createDropzone({
      id: 'form-pdf',
      initialFiles: ctx.initialFiles,
      label: 'Ausfüllbare PDF auswählen',
      onFilesChange: async (files) => {
        clear(fieldsHost);
        controlGetters.clear();
        if (!files.length) return;
        try {
          loadedFields = await runWorkerOp('inspectForm', { bytes: files[0].bytes });
          if (!loadedFields.length) {
            fieldsHost.appendChild(el('p', { className: 'muted-copy' }, 'Diese PDF enthält keine interaktiven AcroForm-Felder.'));
            return;
          }
          loadedFields.forEach((f, idx) => {
            const id = `acro-${idx}`;
            if (f.kind === 'checkbox') {
              const cb = el('input', { type: 'checkbox', id, checked: Boolean(f.value) });
              controlGetters.set(f.name, () => cb.checked);
              fieldsHost.appendChild(el('label', { htmlFor: id, className: 'choice-row' }, cb, sanitizeDisplayText(f.name, 80)));
            } else if ((f.kind === 'dropdown' || f.kind === 'radio') && Array.isArray(f.options)) {
              const sel = el('select', { id }, f.options.map((o) => el('option', { value: o, selected: o === f.value }, sanitizeDisplayText(o, 60))));
              controlGetters.set(f.name, () => sel.value);
              fieldsHost.appendChild(makeLabeledField(id, sanitizeDisplayText(f.name, 80), sel));
            } else {
              const inp = el('input', { type: 'text', id, value: f.value || '' });
              controlGetters.set(f.name, () => inp.value);
              fieldsHost.appendChild(makeLabeledField(id, sanitizeDisplayText(f.name, 80), inp));
            }
          });
        } catch (err) {
          shell.setError(err.message);
        }
      }
    });
    if (ctx.initialFiles.length) dz.setFiles(ctx.initialFiles);

    const runBtn = makePrimaryButton('Formular speichern', () => {
      shell.runTask(runBtn, 'Formularfelder werden geschrieben …', async () => {
        const files = dz.getFiles();
        if (!files.length) throw new Error('Bitte wähle zuerst eine PDF-Datei aus.');
        const valuesMap = {};
        for (const [k, getVal] of controlGetters.entries()) {
          valuesMap[k] = getVal();
        }
        const out = await runWorkerOp('fillForm', { bytes: files[0].bytes, valuesMap, flatten: flattenCheck.checked });
        shell.resultPanel.show({
          filename: `${files[0].name}-ausgefuellt.pdf`,
          bytes: out,
          originalBytesLen: files[0].bytes.byteLength,
          summary: `${Object.keys(valuesMap).length} Formularfeld(er) gespeichert.`
        });
      });
    });

    shell.leftPanel.append(dz.element, fieldsHost);
    shell.rightPanel.append(
      el('h2', {}, 'Formular-Optionen'),
      el('label', { htmlFor: 'form-flatten', className: 'choice-row' }, flattenCheck, 'Felder nach dem Ausfüllen fest einbrennen'),
      runBtn
    );
    return { element: shell.root, cleanup };
  }

  if (tool.id === 'bookmarks') {
    const items = [];
    const listEl = el('ul', { className: 'file-list' });
    const titleIn = el('input', { type: 'text', id: 'bm-title', placeholder: 'Kapitel 1 – Einleitung' });
    const pageIn = el('input', { type: 'number', id: 'bm-page', value: '1', min: 1 });
    attachClearOnInput(titleIn);

    function renderBm() {
      clear(listEl);
      items.forEach((bm, idx) => {
        listEl.appendChild(
          el(
            'li',
            { className: 'file-item' },
            el('span', { className: 'file-item-name' }, `S. ${bm.pageNumber} · ${bm.title}`),
            el('button', {
              type: 'button',
              className: 'icon-btn',
              'aria-label': `Lesezeichen ${bm.title} löschen`,
              onClick: () => { items.splice(idx, 1); renderBm(); }
            }, '×')
          )
        );
      });
    }

    const dz = createDropzone({ id: 'bm-pdf', initialFiles: ctx.initialFiles, label: 'PDF auswählen' });
    const addBtn = el('button', {
      type: 'button',
      className: 'cta-button',
      onClick: () => {
        const t = titleIn.value.trim();
        if (!t) { titleIn.setAttribute('aria-invalid', 'true'); titleIn.focus(); return; }
        items.push({ title: t, pageNumber: Math.max(1, Number(pageIn.value) || 1) });
        titleIn.value = '';
        renderBm();
      }
    }, 'Lesezeichen hinzufügen');

    const runBtn = makePrimaryButton('Lesezeichen speichern', () => {
      shell.runTask(runBtn, 'Inhaltsverzeichnis wird in PDF geschrieben …', async () => {
        const files = dz.getFiles();
        if (!files.length) throw new Error('Bitte wähle eine PDF-Datei aus.');
        const out = await runWorkerOp('setBookmarks', { bytes: files[0].bytes, items });
        shell.resultPanel.show({
          filename: `${files[0].name}-lesezeichen.pdf`,
          bytes: out,
          originalBytesLen: files[0].bytes.byteLength,
          summary: `${items.length} Lesezeichen im PDF-Katalog gespeichert.`
        });
      });
    });

    shell.leftPanel.append(dz.element, listEl);
    shell.rightPanel.append(
      el('h2', {}, 'Neues Lesezeichen'),
      makeLabeledField('bm-title', 'Titel', titleIn),
      makeLabeledField('bm-page', 'Zielseite', pageIn),
      addBtn,
      runBtn
    );
    return { element: shell.root, cleanup };
  }

  // metadata-edit (+ full structural & security inspection)
  const auditBox = el('div', { className: 'form-stack' });
  const titleIn = el('input', { type: 'text', id: 'meta-title' });
  const authorIn = el('input', { type: 'text', id: 'meta-author' });
  const subjectIn = el('input', { type: 'text', id: 'meta-subject' });
  const keywordsIn = el('input', { type: 'text', id: 'meta-keywords', placeholder: 'Komma-getrennt' });
  const creatorIn = el('input', { type: 'text', id: 'meta-creator' });
  const producerIn = el('input', { type: 'text', id: 'meta-producer' });

  function renderAudit(info) {
    clear(auditBox);
    const rows = [
      ['PDF-Version', info.version],
      ['Seiten', String(info.pageCount)],
      ['Seitenformat (Seite 1)', `${info.firstPageMm.width} × ${info.firstPageMm.height} mm`],
      ['Verschlüsselt', info.isEncrypted ? 'Ja' : 'Nein'],
      ['XMP-Metadaten-Stream', info.hasXmpMetadata ? 'Vorhanden' : 'Nicht vorhanden'],
      ['Formularfelder', String(info.formFieldCount)],
      ['Aktive Skript-/Action-Tokens', info.hasActiveScriptTokens ? 'Erkannt (werden im Viewer blockiert)' : 'Keine erkannt']
    ];
    const table = el(
      'table',
      { className: 'data-table' },
      el('caption', { className: 'visually-hidden' }, 'Struktur- und Sicherheitsanalyse der PDF'),
      el('tbody', {}, rows.map(([k, v]) => el('tr', {}, el('th', { scope: 'row' }, k), el('td', {}, v))))
    );
    auditBox.append(el('h3', {}, 'Struktur- & Sicherheitsprüfung'), table);
  }

  const dz = createDropzone({
    id: 'meta-pdf',
    initialFiles: ctx.initialFiles,
    label: 'PDF prüfen und Metadaten laden',
    onFilesChange: async (files) => {
      clear(auditBox);
      if (!files.length) return;
      try {
        const info = await runWorkerOp('inspectInfo', { bytes: files[0].bytes });
        renderAudit(info);
        titleIn.value = sanitizeDisplayText(info.metadata.title, 250);
        authorIn.value = sanitizeDisplayText(info.metadata.author, 250);
        subjectIn.value = sanitizeDisplayText(info.metadata.subject, 400);
        keywordsIn.value = sanitizeDisplayText(info.metadata.keywords, 300);
        creatorIn.value = sanitizeDisplayText(info.metadata.creator, 200);
        producerIn.value = sanitizeDisplayText(info.metadata.producer, 200);
      } catch (err) {
        shell.setError(err.message);
      }
    }
  });
  if (ctx.initialFiles.length) dz.setFiles(ctx.initialFiles);

  const runBtn = makePrimaryButton('Metadaten speichern', () => {
    shell.runTask(runBtn, 'Dokument-Infos werden aktualisiert …', async () => {
      const files = dz.getFiles();
      if (!files.length) throw new Error('Bitte wähle eine PDF-Datei aus.');
      const out = await runWorkerOp('writeMetadata', {
        bytes: files[0].bytes,
        metadata: {
          title: titleIn.value,
          author: authorIn.value,
          subject: subjectIn.value,
          keywords: keywordsIn.value,
          creator: creatorIn.value,
          producer: producerIn.value
        }
      });
      shell.resultPanel.show({
        filename: `${files[0].name}-infos.pdf`,
        bytes: out,
        originalBytesLen: files[0].bytes.byteLength,
        summary: 'Dokument-Informationen aktualisiert.'
      });
    });
  });

  shell.leftPanel.append(dz.element, auditBox);
  shell.rightPanel.append(
    el('h2', {}, 'Metadaten bearbeiten'),
    makeLabeledField('meta-title', 'Titel', titleIn),
    makeLabeledField('meta-author', 'Autor', authorIn),
    makeLabeledField('meta-subject', 'Thema / Betreff', subjectIn),
    makeLabeledField('meta-keywords', 'Stichwörter', keywordsIn),
    makeLabeledField('meta-creator', 'Erstellt mit', creatorIn),
    makeLabeledField('meta-producer', 'PDF-Produzent', producerIn),
    runBtn
  );
  return { element: shell.root, cleanup };
}
