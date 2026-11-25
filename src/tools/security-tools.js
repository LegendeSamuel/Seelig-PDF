import { clear, el } from '../ui/dom.js';
import { createDropzone } from '../ui/dropzone.js';
import { createInteractivePdfStage } from '../ui/canvas-editor.js';
import { runWorkerOp } from '../engine/worker-client.js';
import { extractPdfText, renderPdfToImages } from '../engine/pdf-render.js';
import { comparePdfPageVisual, diffTextLines } from '../engine/compare.js';
import { generateSecurePassword, sanitizeDisplayText } from '../security/sanitize.js';
import {
  attachClearOnInput,
  buildToolShell,
  makeLabeledField,
  makePasswordField,
  makePrimaryButton,
  makeRadioGroup
} from './workspace-helper.js';

export function mountSecurityTool(tool, ctx) {
  const shell = buildToolShell({
    tool,
    onBack: ctx.goHome,
    onChainToTool: ctx.chainToTool
  });
  let extraCleanup = null;
  const cleanup = () => {
    if (extraCleanup) extraCleanup();
  };

  if (tool.id === 'compress') {
    let level = 'lossless';
    const dz = createDropzone({ id: 'comp-pdf', initialFiles: ctx.initialFiles, label: 'PDF zum Verkleinern auswählen' });
    const lvlGroup = makeRadioGroup(
      'Kompressionsstufe',
      'comp-level',
      [
        { value: 'lossless', label: 'Verlustfrei (Objektströme komprimieren & Metadaten entfernen)' },
        { value: 'balanced', label: 'Ausgewogen (150 DPI Bild-Kompression)' },
        { value: 'compact', label: 'Stark komprimiert (96 DPI für E-Mail/Web)' }
      ],
      level,
      (v) => { level = v; }
    );

    const runBtn = makePrimaryButton('PDF komprimieren', () => {
      shell.runTask(runBtn, 'PDF wird komprimiert …', async ({ setProgress }) => {
        const files = dz.getFiles();
        if (!files.length) throw new Error('Bitte wähle eine PDF-Datei aus.');
        const orig = files[0].bytes;
        let out;
        if (level === 'lossless') {
          out = await runWorkerOp('compressLossless', { bytes: orig });
        } else {
          const dpi = level === 'compact' ? 96 : 150;
          const quality = level === 'compact' ? 0.62 : 0.78;
          const imgs = await renderPdfToImages(orig, { format: 'jpeg', dpi, quality, onProgress: setProgress });
          out = await runWorkerOp('rebuildFromImages', { imagePages: imgs });
        }
        shell.resultPanel.show({
          filename: `${files[0].name}-komprimiert.pdf`,
          bytes: out,
          originalBytesLen: orig.byteLength,
          summary: `Komprimierung (${level}) abgeschlossen.`
        });
      });
    });

    shell.leftPanel.append(dz.element);
    shell.rightPanel.append(el('h2', {}, 'Kompression'), lvlGroup, runBtn);
    return { element: shell.root, cleanup };
  }

  if (tool.id === 'protect') {
    const dz = createDropzone({ id: 'prot-pdf', initialFiles: ctx.initialFiles, label: 'Zu schützende PDF auswählen' });
    const userPwd = makePasswordField('prot-user-pwd', 'Öffnen-Passwort (Benutzer)', {
      autocomplete: 'new-password',
      hint: 'Wird beim Öffnen der PDF abgefragt.'
    });
    const ownerPwd = makePasswordField('prot-owner-pwd', 'Besitzer-Passwort (optional)', {
      autocomplete: 'new-password',
      hint: 'Schützt Berechtigungen (Drucken/Kopieren). Falls leer, wird das Öffnen-Passwort genutzt.'
    });
    attachClearOnInput(userPwd.input);

    const permPrint = el('input', { type: 'checkbox', id: 'perm-print', checked: true });
    const permCopy = el('input', { type: 'checkbox', id: 'perm-copy' });
    const permMod = el('input', { type: 'checkbox', id: 'perm-mod' });

    const genBtn = el(
      'button',
      {
        type: 'button',
        className: 'cta-button cta-button--ghost',
        onClick: () => {
          const pwd = generateSecurePassword({ length: 18, symbols: true });
          userPwd.input.value = pwd;
          userPwd.input.type = 'text';
          userPwd.input.removeAttribute('aria-invalid');
        }
      },
      'Sicheres Passwort generieren (CSPRNG)'
    );

    const runBtn = makePrimaryButton('Mit AES-256 verschlüsseln', () => {
      shell.runTask(runBtn, 'PDF wird mit AES-256 verschlüsselt …', async () => {
        const files = dz.getFiles();
        if (!files.length) throw new Error('Bitte wähle eine PDF-Datei aus.');
        if (!userPwd.input.value && !ownerPwd.input.value) {
          userPwd.input.setAttribute('aria-invalid', 'true');
          userPwd.input.focus();
          throw new Error('Bitte vergib mindestens ein Passwort.');
        }
        const out = await runWorkerOp('protect', {
          bytes: files[0].bytes,
          options: {
            userPassword: userPwd.input.value,
            ownerPassword: ownerPwd.input.value || userPwd.input.value,
            permissions: {
              printing: permPrint.checked,
              copying: permCopy.checked,
              modifying: permMod.checked
            }
          }
        });
        shell.resultPanel.show({
          filename: `${files[0].name}-geschuetzt.pdf`,
          bytes: out,
          originalBytesLen: files[0].bytes.byteLength,
          chainable: false,
          summary: 'Dokument nach ISO 32000-2 (AES-256) verschlüsselt.'
        });
      });
    });

    shell.leftPanel.append(dz.element);
    shell.rightPanel.append(
      el('h2', {}, 'Passwortschutz & Rechte'),
      userPwd.wrap,
      genBtn,
      ownerPwd.wrap,
      el('label', { htmlFor: 'perm-print', className: 'choice-row' }, permPrint, 'Drucken in hoher Auflösung erlauben'),
      el('label', { htmlFor: 'perm-copy', className: 'choice-row' }, permCopy, 'Text & Bilder kopieren erlauben'),
      el('label', { htmlFor: 'perm-mod', className: 'choice-row' }, permMod, 'Änderungen am Dokument erlauben'),
      runBtn
    );
    return { element: shell.root, cleanup };
  }

  if (tool.id === 'unlock') {
    const dz = createDropzone({ id: 'unlock-pdf', initialFiles: ctx.initialFiles, label: 'Geschützte PDF auswählen' });
    const pwdField = makePasswordField('unlock-pwd', 'Aktuelles PDF-Passwort', {
      autocomplete: 'current-password',
      hint: 'Nur für autorisierte Entschlüsselung bei bekanntem Passwort.'
    });
    attachClearOnInput(pwdField.input);

    const runBtn = makePrimaryButton('Passwortschutz entfernen', () => {
      shell.runTask(runBtn, 'PDF wird entschlüsselt …', async () => {
        const files = dz.getFiles();
        if (!files.length) throw new Error('Bitte wähle eine PDF-Datei aus.');
        if (!pwdField.input.value) {
          pwdField.input.setAttribute('aria-invalid', 'true');
          pwdField.input.focus();
          throw new Error('Bitte gib das aktuelle Passwort ein.');
        }
        const out = await runWorkerOp('unlock', { bytes: files[0].bytes, password: pwdField.input.value });
        shell.resultPanel.show({
          filename: `${files[0].name}-entsperrt.pdf`,
          bytes: out,
          originalBytesLen: files[0].bytes.byteLength,
          summary: 'Passwortschutz sauber entfernt.'
        });
      });
    });

    shell.leftPanel.append(dz.element);
    shell.rightPanel.append(el('h2', {}, 'Entschlüsseln'), pwdField.wrap, runBtn);
    return { element: shell.root, cleanup };
  }

  if (tool.id === 'redact') {
    let dpi = '150';
    const stage = createInteractivePdfStage({
      mode: 'redact',
      boxClass: 'stage-box--redact'
    });
    extraCleanup = stage.cleanup;
    stage.setPayloadProvider(() => ({ label: 'Schwärzung' }));

    const dz = createDropzone({
      id: 'redact-pdf',
      initialFiles: ctx.initialFiles,
      label: 'PDF zum echten Schwärzen wählen',
      onFilesChange: (files) => {
        if (files.length) stage.loadPdf(files[0].bytes).catch((e) => shell.setError(e.message));
      }
    });
    if (ctx.initialFiles.length) dz.setFiles(ctx.initialFiles);

    const dpiGroup = makeRadioGroup(
      'Raster-Auflösung geschwärzter Seiten',
      'redact-dpi',
      [
        { value: '150', label: '150 DPI (Standard, schnell)' },
        { value: '220', label: '220 DPI (Extra scharf)' }
      ],
      dpi,
      (v) => { dpi = v; }
    );

    const runBtn = makePrimaryButton('Unwiderruflich schwärzen', () => {
      shell.runTask(runBtn, 'Markierte Seiten werden Pixel-genau neu aufgebaut …', async ({ setProgress }) => {
        const files = dz.getFiles();
        if (!files.length) throw new Error('Bitte wähle eine PDF-Datei aus.');
        const boxes = stage.getBoxes();
        if (!boxes.length) throw new Error('Ziehe auf der PDF-Vorschau mindestens ein schwarzes Rechteck auf.');

        const byPage = new Map();
        for (const b of boxes) {
          if (!byPage.has(b.pageNumber)) byPage.set(b.pageNumber, []);
          byPage.get(b.pageNumber).push(b);
        }
        const targetIndices = Array.from(byPage.keys()).map((p) => p - 1);
        const rendered = await renderPdfToImages(files[0].bytes, {
          format: 'png',
          dpi: Number(dpi),
          pageIndices: targetIndices,
          redactionsByPage: byPage,
          onProgress: setProgress
        });

        const redactedEntries = rendered.map((r) => [r.pageNumber, { format: r.format, bytes: r.bytes }]);
        const out = await runWorkerOp('buildRedactedPdf', { bytes: files[0].bytes, redactedEntries });
        shell.resultPanel.show({
          filename: `${files[0].name}-geschwaerzt.pdf`,
          bytes: out,
          originalBytesLen: files[0].bytes.byteLength,
          summary: `${boxes.length} Bereich(e) auf ${rendered.length} Seite(n) zerstörungsfrei entfernt – kein kopierbarer Text verbleibt unter der Schwärzung.`
        });
      });
    });

    shell.leftPanel.append(dz.element, stage.element);
    shell.rightPanel.append(
      el('h2', {}, 'Echte Pixel-Schwärzung'),
      el('div', { className: 'legal-note' }, 'Geschwärzte Seiten werden gerastert, pixelgenau mit Schwarz überschrieben und neu gespeichert. Darunterliegender Text wird vollständig entfernt.'),
      dpiGroup,
      runBtn
    );
    return { element: shell.root, cleanup };
  }

  if (tool.id === 'strip-metadata') {
    const proofBox = el('div', { className: 'form-stack' });
    const dz = createDropzone({ id: 'strip-pdf', initialFiles: ctx.initialFiles, label: 'PDF bereinigen' });

    const runBtn = makePrimaryButton('Alle Metadaten entfernen', () => {
      shell.runTask(runBtn, 'Info-Dictionary und XMP-Stream werden gelöscht …', async () => {
        clear(proofBox);
        const files = dz.getFiles();
        if (!files.length) throw new Error('Bitte wähle eine PDF-Datei aus.');
        const { bytes, before, after } = await runWorkerOp('stripMetadata', { bytes: files[0].bytes });

        const rows = [
          ['Titel', sanitizeDisplayText(before.metadata.title) || '—', sanitizeDisplayText(after.metadata.title) || 'Entfernt'],
          ['Autor', sanitizeDisplayText(before.metadata.author) || '—', sanitizeDisplayText(after.metadata.author) || 'Entfernt'],
          ['Thema', sanitizeDisplayText(before.metadata.subject) || '—', sanitizeDisplayText(after.metadata.subject) || 'Entfernt'],
          ['Erstellt mit', sanitizeDisplayText(before.metadata.creator) || '—', sanitizeDisplayText(after.metadata.creator) || 'Entfernt'],
          ['Produzent', sanitizeDisplayText(before.metadata.producer) || '—', sanitizeDisplayText(after.metadata.producer) || 'Entfernt'],
          ['XMP-Stream', before.hasXmpMetadata ? 'Vorhanden' : 'Keine', after.hasXmpMetadata ? 'Vorhanden' : 'Entfernt']
        ];

        proofBox.append(
          el('h3', {}, 'Bereinigungsnachweis'),
          el(
            'table',
            { className: 'data-table' },
            el('thead', {}, el('tr', {}, el('th', {}, 'Feld'), el('th', {}, 'Vorher'), el('th', {}, 'Nachher'))),
            el('tbody', {}, rows.map(([f, b, a]) => el('tr', {}, el('th', { scope: 'row' }, f), el('td', {}, b), el('td', {}, a))))
          )
        );

        shell.resultPanel.show({
          filename: `${files[0].name}-ohne-metadaten.pdf`,
          bytes,
          originalBytesLen: files[0].bytes.byteLength,
          summary: 'Alle Metadaten und XMP-Streams vollständig entfernt.'
        });
      });
    });

    shell.leftPanel.append(dz.element, proofBox);
    shell.rightPanel.append(
      el('h2', {}, 'Datenschutz-Bereinigung'),
      el('p', { className: 'muted-copy' }, 'Entfernt versteckte Autorennamen, Software-Spuren, Zeitstempel und XMP-XML-Metadaten.'),
      runBtn
    );
    return { element: shell.root, cleanup };
  }

  if (tool.id === 'flatten') {
    let mode = 'acroform';
    let dpi = '150';
    const dz = createDropzone({ id: 'flat-pdf', initialFiles: ctx.initialFiles, label: 'PDF auswählen' });
    const modeGroup = makeRadioGroup(
      'Verarbeitungsmodus',
      'flat-mode',
      [
        { value: 'acroform', label: 'Formularfelder fest einbrennen (Vektor bleibt erhalten)' },
        { value: 'rasterize', label: 'Komplett rastern (entfernt alle Skripte, Ebenen & Vektor-Schichten)' },
        { value: 'grayscale', label: 'In Graustufen umwandeln (Schwarz/Weiß-Druck)' },
        { value: 'invert', label: 'Farben invertieren (Dunkelmodus)' }
      ],
      mode,
      (v) => { mode = v; }
    );
    const dpiGroup = makeRadioGroup(
      'Auflösung (bei Raster/Graustufen/Invertieren)',
      'flat-dpi',
      [
        { value: '150', label: '150 DPI' },
        { value: '220', label: '220 DPI' }
      ],
      dpi,
      (v) => { dpi = v; }
    );

    const runBtn = makePrimaryButton('PDF umwandeln & glätten', () => {
      shell.runTask(runBtn, 'PDF wird verarbeitet …', async ({ setProgress }) => {
        const files = dz.getFiles();
        if (!files.length) throw new Error('Bitte wähle eine PDF-Datei aus.');
        let out;
        if (mode === 'acroform') {
          out = await runWorkerOp('flattenAcroForm', { bytes: files[0].bytes });
        } else {
          const filterMode = mode === 'grayscale' ? 'grayscale' : mode === 'invert' ? 'invert' : 'none';
          const imgs = await renderPdfToImages(files[0].bytes, {
            format: 'png',
            dpi: Number(dpi),
            filterMode,
            onProgress: setProgress
          });
          out = await runWorkerOp('rebuildFromImages', { imagePages: imgs });
        }
        shell.resultPanel.show({
          filename: `${files[0].name}-${mode}.pdf`,
          bytes: out,
          originalBytesLen: files[0].bytes.byteLength,
          summary: `Modus „${mode}“ erfolgreich abgeschlossen.`
        });
      });
    });

    shell.leftPanel.append(dz.element);
    shell.rightPanel.append(el('h2', {}, 'Glätten & Farbfilter'), modeGroup, dpiGroup, runBtn);
    return { element: shell.root, cleanup };
  }

  // compare
  const dzA = createDropzone({ id: 'cmp-a', initialFiles: ctx.initialFiles, label: '1. Original-PDF (A)' });
  const dzB = createDropzone({ id: 'cmp-b', label: '2. Vergleichs-PDF (B)' });
  const pageIn = el('input', { type: 'number', id: 'cmp-page', value: '1', min: 1 });
  const diffHost = el('div', { className: 'form-stack' });

  const runBtn = makePrimaryButton('PDFs vergleichen', () => {
    shell.runTask(runBtn, 'Seiten und Texte werden pixelgenau verglichen …', async () => {
      clear(diffHost);
      const a = dzA.getFiles();
      const b = dzB.getFiles();
      if (!a.length || !b.length) throw new Error('Bitte lade beide PDF-Dateien hoch.');

      const pageNum = Math.max(1, Number(pageIn.value) || 1);
      const visual = await comparePdfPageVisual(a[0].bytes, b[0].bytes, pageNum);
      const [txtA, txtB] = await Promise.all([
        extractPdfText(a[0].bytes),
        extractPdfText(b[0].bytes)
      ]);
      const textDiff = diffTextLines(txtA.text, txtB.text);

      const makeCanvasCard = (title, imgData) => {
        const c = el('canvas', { width: imgData.width, height: imgData.height, style: 'max-width:100%;height:auto;border-radius:6px;border:1px solid var(--line);' });
        c.getContext('2d').putImageData(imgData, 0, 0);
        return el('div', { className: 'form-group' }, el('span', { className: 'eyebrow' }, title), c);
      };

      const canvasesRow = el(
        'div',
        { className: 'tools-grid' },
        makeCanvasCard(`Datei A (${visual.pageCountA} S.)`, visual.imageDataA),
        makeCanvasCard(`Datei B (${visual.pageCountB} S.)`, visual.imageDataB),
        makeCanvasCard(`Abweichung: ${visual.diffPercent} %`, visual.diffImageData)
      );

      diffHost.append(
        el('div', { className: 'alert-banner alert-banner--ok' }, `Seite ${visual.pageNumber}: ${visual.diffPercent} % abweichende Pixel (in Amber markiert).`),
        canvasesRow,
        el('h3', {}, 'Text-Unterschiede'),
        el('pre', { className: 'diff-pre' }, textDiff)
      );
    });
  });

  shell.leftPanel.append(dzA.element, dzB.element, diffHost);
  shell.rightPanel.append(
    el('h2', {}, 'Vergleichseinstellungen'),
    makeLabeledField('cmp-page', 'Zu vergleichende Seite', pageIn),
    runBtn
  );
  return { element: shell.root, cleanup };
}
