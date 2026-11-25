import { el } from '../ui/dom.js';
import { createDropzone } from '../ui/dropzone.js';
import { createPageGrid } from '../ui/page-grid.js';
import { runWorkerOp } from '../engine/worker-client.js';
import { getPdfPageCount } from '../engine/pdf-render.js';
import { parsePageRanges } from '../security/sanitize.js';
import {
  attachClearOnInput,
  buildToolShell,
  makeLabeledField,
  makePrimaryButton,
  makeRadioGroup
} from './workspace-helper.js';

export function mountOrganizeTool(tool, ctx) {
  const shell = buildToolShell({
    tool,
    onBack: ctx.goHome,
    onChainToTool: ctx.chainToTool
  });
  let pageGrid = null;

  const cleanup = () => {
    if (pageGrid) pageGrid.cleanup();
  };

  if (tool.id === 'merge') {
    const dz = createDropzone({
      id: 'merge-files',
      multiple: true,
      initialFiles: ctx.initialFiles,
      label: 'Mindestens zwei PDF-Dateien auswählen oder ablegen',
      hint: 'Reihenfolge kannst du über ‹ / › direkt in der Liste sortieren.'
    });
    const runBtn = makePrimaryButton('PDFs zusammenfügen', () => {
      shell.runTask(runBtn, 'PDF-Dateien werden zusammengefügt …', async () => {
        const files = dz.getFiles();
        if (files.length < 2) throw new Error('Bitte lade mindestens zwei PDF-Dateien hoch.');
        const out = await runWorkerOp('merge', { files: files.map((f) => f.bytes) });
        const totalIn = files.reduce((s, f) => s + f.bytes.byteLength, 0);
        shell.resultPanel.show({
          filename: 'zusammengefuegt.pdf',
          bytes: out,
          originalBytesLen: totalIn,
          summary: `${files.length} Dokumente erfolgreich kombiniert.`
        });
      });
    });
    shell.leftPanel.append(dz.element);
    shell.rightPanel.append(
      el('h2', {}, 'Optionen'),
      el('p', { className: 'muted-copy' }, 'Alle Seiten werden verlustfrei in der gewählten Reihenfolge verbunden.'),
      runBtn
    );
    return { element: shell.root, cleanup };
  }

  if (tool.id === 'split') {
    let mode = 'all';
    let pageCount = 0;
    const infoLine = el('p', { className: 'muted-copy' }, 'Noch keine PDF geladen.');
    const chunkInput = el('input', { type: 'number', id: 'split-chunk', min: 1, max: 200, value: '2' });
    const groupInput = el('input', { type: 'text', id: 'split-groups', placeholder: '1-3; 4-6; 7' });
    attachClearOnInput(groupInput);

    const chunkWrap = makeLabeledField('split-chunk', 'Seiten pro Teil-PDF', chunkInput);
    const groupWrap = makeLabeledField('split-groups', 'Bereiche (mit Semikolon trennen)', groupInput, 'Beispiel: 1-2; 3-5; 6');
    chunkWrap.hidden = true;
    groupWrap.hidden = true;

    const dz = createDropzone({
      id: 'split-file',
      initialFiles: ctx.initialFiles,
      label: 'PDF zum Trennen auswählen',
      onFilesChange: async (files) => {
        if (!files.length) {
          pageCount = 0;
          infoLine.textContent = 'Noch keine PDF geladen.';
          return;
        }
        try {
          pageCount = await getPdfPageCount(files[0].bytes);
          infoLine.textContent = `Erkannte Seiten: ${pageCount}`;
        } catch (err) {
          shell.setError(err.message);
        }
      }
    });
    if (ctx.initialFiles.length) dz.setFiles(ctx.initialFiles);

    const modeGroup = makeRadioGroup(
      'Trennmodus',
      'split-mode',
      [
        { value: 'all', label: 'Jede Seite als eigene PDF (ZIP)' },
        { value: 'fixed', label: 'Alle N Seiten teilen (ZIP)' },
        { value: 'groups', label: 'Nach Seitenbereichen teilen' }
      ],
      mode,
      (v) => {
        mode = v;
        chunkWrap.hidden = v !== 'fixed';
        groupWrap.hidden = v !== 'groups';
      }
    );

    const runBtn = makePrimaryButton('PDF trennen', () => {
      shell.runTask(runBtn, 'PDF wird geteilt …', async () => {
        const files = dz.getFiles();
        if (!files.length) throw new Error('Bitte wähle zuerst eine PDF-Datei aus.');
        const count = pageCount || (await getPdfPageCount(files[0].bytes));
        const options = { mode };
        if (mode === 'fixed') options.chunkSize = Number(chunkInput.value) || 2;
        if (mode === 'groups') {
          const rawGroups = groupInput.value.split(';').map((s) => s.trim()).filter(Boolean);
          if (!rawGroups.length) {
            groupInput.setAttribute('aria-invalid', 'true');
            groupInput.focus();
            throw new Error('Bitte gib mindestens einen Bereich ein (z. B. 1-3; 4-6).');
          }
          options.groups = rawGroups.map((g) => parsePageRanges(g, count));
        }

        const parts = await runWorkerOp('split', { bytes: files[0].bytes, options });
        if (parts.length === 1) {
          shell.resultPanel.show({
            filename: `${files[0].name}-${parts[0].nameSuffix}.pdf`,
            bytes: parts[0].bytes,
            summary: '1 Teil-PDF erstellt.'
          });
        } else {
          const zipBytes = await runWorkerOp('zip', {
            entries: parts.map((p) => ({ name: `${p.nameSuffix}.pdf`, bytes: p.bytes }))
          });
          shell.resultPanel.show({
            filename: `${files[0].name}-geteilt.zip`,
            bytes: zipBytes,
            mime: 'application/zip',
            ext: '.zip',
            chainable: false,
            summary: `${parts.length} PDF-Dateien als ZIP-Archiv verpackt.`
          });
        }
      });
    });

    shell.leftPanel.append(dz.element, infoLine);
    shell.rightPanel.append(el('h2', {}, 'Einstellungen'), modeGroup, chunkWrap, groupWrap, runBtn);
    return { element: shell.root, cleanup };
  }

  if (tool.id === 'organize') {
    pageGrid = createPageGrid({
      selectable: false,
      reorderable: true,
      rotatable: true,
      deletable: true,
      duplicable: true,
      onInspectPage: ctx.openPagePreview
    });
    const dz = createDropzone({
      id: 'org-files',
      multiple: true,
      initialFiles: ctx.initialFiles,
      label: 'Eine oder mehrere PDF-Dateien laden',
      onFilesChange: (files) => {
        pageGrid.loadFromFiles(files).catch((e) => shell.setError(e.message));
      }
    });
    if (ctx.initialFiles.length) dz.setFiles(ctx.initialFiles);

    const runBtn = makePrimaryButton('PDF neu erstellen', () => {
      shell.runTask(runBtn, 'Seitenstruktur wird gespeichert …', async () => {
        const files = dz.getFiles();
        if (!files.length) throw new Error('Bitte lade mindestens eine PDF-Datei hoch.');
        const plan = pageGrid.getItems().map((i) => ({
          fileIndex: i.fileIndex,
          pageIndex: i.pageIndex,
          rotateDeg: i.rotateDeg
        }));
        const out = await runWorkerOp('organize', { files: files.map((f) => f.bytes), plan });
        shell.resultPanel.show({
          filename: `${files[0].name}-sortiert.pdf`,
          bytes: out,
          originalBytesLen: files[0].bytes.byteLength,
          summary: `${plan.length} Seiten in neuer Reihenfolge gespeichert.`
        });
      });
    });

    shell.leftPanel.append(dz.element, pageGrid.element);
    shell.rightPanel.append(
      el('h2', {}, 'Seitensteuerung'),
      el('p', { className: 'muted-copy' }, 'Verschiebe Seiten mit ‹ / ›, drehe mit ↻, dupliziere mit ⊕ oder entferne unerwünschte Seiten.'),
      runBtn
    );
    return { element: shell.root, cleanup };
  }

  if (tool.id === 'delete-pages' || tool.id === 'extract-pages') {
    const isDelete = tool.id === 'delete-pages';
    let pageCount = 0;
    const rangeInput = el('input', { type: 'text', id: 'page-range-input', placeholder: 'z. B. 1-3, 5' });
    attachClearOnInput(rangeInput);
    const separateCheck = el('input', { type: 'checkbox', id: 'extract-separate' });

    pageGrid = createPageGrid({
      selectable: true,
      onInspectPage: ctx.openPagePreview,
      onChange: (items) => {
        const selectedNums = items.filter((i) => i.selected).map((i) => i.pageNumber);
        if (selectedNums.length > 0) rangeInput.value = selectedNums.join(', ');
      }
    });

    const dz = createDropzone({
      id: `${tool.id}-file`,
      initialFiles: ctx.initialFiles,
      label: 'PDF-Datei auswählen',
      onFilesChange: async (files) => {
        if (!files.length) {
          pageCount = 0;
          await pageGrid.loadFromFiles([]);
          return;
        }
        try {
          pageCount = await getPdfPageCount(files[0].bytes);
          await pageGrid.loadFromFiles(files);
        } catch (err) {
          shell.setError(err.message);
        }
      }
    });
    if (ctx.initialFiles.length) dz.setFiles(ctx.initialFiles);

    const runBtn = makePrimaryButton(
      isDelete ? 'Markierte Seiten löschen' : 'Seiten extrahieren',
      () => {
        shell.runTask(runBtn, 'Seiten werden verarbeitet …', async () => {
          const files = dz.getFiles();
          if (!files.length) throw new Error('Bitte lade zuerst eine PDF-Datei hoch.');
          const total = pageCount || (await getPdfPageCount(files[0].bytes));
          const indices = parsePageRanges(rangeInput.value, total);

          if (isDelete) {
            const out = await runWorkerOp('deletePages', { bytes: files[0].bytes, pageIndices: indices });
            shell.resultPanel.show({
              filename: `${files[0].name}-bereinigt.pdf`,
              bytes: out,
              originalBytesLen: files[0].bytes.byteLength,
              summary: `${indices.length} Seite(n) entfernt.`
            });
          } else {
            const separate = separateCheck.checked;
            const outputs = await runWorkerOp('extractPages', {
              bytes: files[0].bytes,
              pageIndices: indices,
              separateFiles: separate
            });
            if (outputs.length === 1) {
              shell.resultPanel.show({
                filename: `${files[0].name}-${outputs[0].nameSuffix}.pdf`,
                bytes: outputs[0].bytes,
                summary: `${indices.length} Seite(n) in neue PDF extrahiert.`
              });
            } else {
              const zipBytes = await runWorkerOp('zip', {
                entries: outputs.map((o) => ({ name: `${o.nameSuffix}.pdf`, bytes: o.bytes }))
              });
              shell.resultPanel.show({
                filename: `${files[0].name}-extrahiert.zip`,
                bytes: zipBytes,
                mime: 'application/zip',
                ext: '.zip',
                chainable: false,
                summary: `${outputs.length} Einzelseiten als ZIP gespeichert.`
              });
            }
          }
        });
      }
    );

    shell.leftPanel.append(dz.element, pageGrid.element);
    shell.rightPanel.append(
      el('h2', {}, isDelete ? 'Zu löschende Seiten' : 'Zu extrahierende Seiten'),
      makeLabeledField('page-range-input', 'Seiten oder Bereiche', rangeInput, 'Klicke auf Vorschaubilder (+) oder tippe z. B. 1-3, 5.'),
      !isDelete
        ? el('label', { htmlFor: 'extract-separate', className: 'choice-row' }, separateCheck, 'Jede Seite als eigene PDF (ZIP)')
        : null,
      runBtn
    );
    return { element: shell.root, cleanup };
  }

  if (tool.id === 'rotate') {
    let angle = '90';
    let scope = 'all';
    let pageCount = 0;

    pageGrid = createPageGrid({ selectable: true, onInspectPage: ctx.openPagePreview });
    const dz = createDropzone({
      id: 'rotate-file',
      initialFiles: ctx.initialFiles,
      label: 'PDF-Datei zum Drehen laden',
      onFilesChange: async (files) => {
        if (!files.length) return pageGrid.loadFromFiles([]);
        pageCount = await getPdfPageCount(files[0].bytes);
        await pageGrid.loadFromFiles(files);
      }
    });
    if (ctx.initialFiles.length) dz.setFiles(ctx.initialFiles);

    const angleGroup = makeRadioGroup(
      'Drehwinkel',
      'rotate-angle',
      [
        { value: '90', label: '90° im Uhrzeigersinn' },
        { value: '180', label: '180° (auf den Kopf)' },
        { value: '270', label: '90° gegen den Uhrzeigersinn' }
      ],
      angle,
      (v) => { angle = v; }
    );

    const scopeGroup = makeRadioGroup(
      'Welche Seiten drehen',
      'rotate-scope',
      [
        { value: 'all', label: 'Alle Seiten' },
        { value: 'selected', label: 'Nur ausgewählte Seiten (+)' },
        { value: 'odd', label: 'Nur ungerade Seiten' },
        { value: 'even', label: 'Nur gerade Seiten' }
      ],
      scope,
      (v) => { scope = v; }
    );

    const runBtn = makePrimaryButton('Seiten drehen', () => {
      shell.runTask(runBtn, 'Seiten werden gedreht …', async () => {
        const files = dz.getFiles();
        if (!files.length) throw new Error('Bitte lade zuerst eine PDF-Datei hoch.');
        const count = pageCount || (await getPdfPageCount(files[0].bytes));
        let pageIndices = null;
        if (scope === 'selected') {
          const sel = pageGrid.getSelectedPageNumbers().map((n) => n - 1);
          if (!sel.length) throw new Error('Bitte markiere mindestens eine Seite in der Vorschau.');
          pageIndices = sel;
        } else if (scope === 'odd') {
          pageIndices = Array.from({ length: count }, (_, i) => i).filter((i) => (i + 1) % 2 === 1);
        } else if (scope === 'even') {
          pageIndices = Array.from({ length: count }, (_, i) => i).filter((i) => (i + 1) % 2 === 0);
        }

        const out = await runWorkerOp('rotate', {
          bytes: files[0].bytes,
          options: { angleDeg: Number(angle), pageIndices }
        });
        shell.resultPanel.show({
          filename: `${files[0].name}-gedreht.pdf`,
          bytes: out,
          originalBytesLen: files[0].bytes.byteLength,
          summary: `Seiten um ${angle}° gedreht.`
        });
      });
    });

    shell.leftPanel.append(dz.element, pageGrid.element);
    shell.rightPanel.append(el('h2', {}, 'Drehung festlegen'), angleGroup, scopeGroup, runBtn);
    return { element: shell.root, cleanup };
  }

  if (tool.id === 'nup') {
    let perSheet = '2';
    let orientation = 'landscape';
    const borderCheck = el('input', { type: 'checkbox', id: 'nup-border' });
    const dz = createDropzone({ id: 'nup-file', initialFiles: ctx.initialFiles, label: 'PDF auswählen' });
    const perGroup = makeRadioGroup(
      'Seiten pro Blatt',
      'nup-count',
      [
        { value: '2', label: '2 Seiten pro Blatt' },
        { value: '4', label: '4 Seiten pro Blatt' },
        { value: '6', label: '6 Seiten pro Blatt' },
        { value: '9', label: '9 Seiten pro Blatt' }
      ],
      perSheet,
      (v) => { perSheet = v; }
    );
    const orientGroup = makeRadioGroup(
      'Blattausrichtung',
      'nup-orient',
      [
        { value: 'landscape', label: 'A4 Querformat' },
        { value: 'portrait', label: 'A4 Hochformat' }
      ],
      orientation,
      (v) => { orientation = v; }
    );

    const runBtn = makePrimaryButton('Blätter anordnen', () => {
      shell.runTask(runBtn, 'Mehrere Seiten werden pro Blatt angeordnet …', async () => {
        const files = dz.getFiles();
        if (!files.length) throw new Error('Bitte wähle eine PDF-Datei aus.');
        const out = await runWorkerOp('nup', {
          bytes: files[0].bytes,
          options: { perSheet: Number(perSheet), landscape: orientation === 'landscape', border: borderCheck.checked }
        });
        shell.resultPanel.show({
          filename: `${files[0].name}-${perSheet}up.pdf`,
          bytes: out,
          originalBytesLen: files[0].bytes.byteLength,
          summary: `${perSheet} Seiten pro A4-Blatt kombiniert.`
        });
      });
    });

    shell.leftPanel.append(dz.element);
    shell.rightPanel.append(
      el('h2', {}, 'Layout'),
      perGroup,
      orientGroup,
      el('label', { htmlFor: 'nup-border', className: 'choice-row' }, borderCheck, 'Feinen Rahmen um jede Seite zeichnen'),
      runBtn
    );
    return { element: shell.root, cleanup };
  }

  if (tool.id === 'booklet') {
    const dz = createDropzone({ id: 'booklet-file', initialFiles: ctx.initialFiles, label: 'PDF für Broschürendruck auswählen' });
    const runBtn = makePrimaryButton('Broschüre ausschießen', () => {
      shell.runTask(runBtn, 'Broschüren-Bögen werden erstellt …', async () => {
        const files = dz.getFiles();
        if (!files.length) throw new Error('Bitte wähle eine PDF-Datei aus.');
        const out = await runWorkerOp('booklet', { bytes: files[0].bytes });
        shell.resultPanel.show({
          filename: `${files[0].name}-broschuere.pdf`,
          bytes: out,
          originalBytesLen: files[0].bytes.byteLength,
          summary: 'Druckfertige A4-Querformat-Bögen (Sattelheftung) erstellt.'
        });
      });
    });

    shell.leftPanel.append(dz.element);
    shell.rightPanel.append(
      el('h2', {}, 'Hinweise zum Druck'),
      el('div', { className: 'legal-note' }, 'Die Seiten werden automatisch auf ein Vielfaches von 4 ergänzt und im A4-Querformat paarweise angeordnet. Drucke die Ausgabe beidseitig über die kurze Kante und falte den Stapel mittig.'),
      runBtn
    );
    return { element: shell.root, cleanup };
  }

  // split-half
  let halfMode = 'vertical';
  const dz = createDropzone({ id: 'split-half-file', initialFiles: ctx.initialFiles, label: 'PDF auswählen' });
  const halfGroup = makeRadioGroup(
    'Schnittmodus',
    'half-mode',
    [
      { value: 'vertical', label: 'Vertikal halbieren (Links / Rechts)' },
      { value: 'horizontal', label: 'Horizontal halbieren (Oben / Unten)' },
      { value: 'poster-2x2', label: 'In 2×2 Poster-Kacheln teilen' }
    ],
    halfMode,
    (v) => { halfMode = v; }
  );
  const runBtn = makePrimaryButton('Seiten aufteilen', () => {
    shell.runTask(runBtn, 'Seiten werden aufgeteilt …', async () => {
      const files = dz.getFiles();
      if (!files.length) throw new Error('Bitte wähle eine PDF-Datei aus.');
      const out = await runWorkerOp('splitHalf', { bytes: files[0].bytes, options: { mode: halfMode } });
      shell.resultPanel.show({
        filename: `${files[0].name}-geteilt.pdf`,
        bytes: out,
        originalBytesLen: files[0].bytes.byteLength,
        summary: 'Jede Seite sauber in Teilbereiche aufgespalten.'
      });
    });
  });

  shell.leftPanel.append(dz.element);
  shell.rightPanel.append(el('h2', {}, 'Aufteilung'), halfGroup, runBtn);
  return { element: shell.root, cleanup };
}
