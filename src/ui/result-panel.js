import { clear, el, svgIcon } from './dom.js';
import { formatBytes, sanitizeFilename } from '../security/sanitize.js';

export function triggerBlobDownload(bytes, filename, mime = 'application/pdf') {
  const blob = bytes instanceof Blob ? bytes : new Blob([bytes], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function createResultPanel({ onChainToTool = () => {}, onOpenInReader = null } = {}) {
  const panel = el('section', { className: 'result-panel', hidden: true, 'aria-live': 'polite' });

  function show({
    filename,
    bytes,
    mime = 'application/pdf',
    ext = '.pdf',
    originalBytesLen = null,
    summary = 'Erfolgreich lokal im Browser erstellt.',
    chainable = true
  }) {
    clear(panel);
    const safeName = sanitizeFilename(filename, ext);
    const outLen = bytes instanceof Blob ? bytes.size : bytes.byteLength;

    const stats = el('div', { className: 'result-stats' });
    stats.appendChild(el('span', {}, `Datei: ${safeName}`));
    stats.appendChild(el('span', {}, `Ausgabe: ${formatBytes(outLen)}`));
    if (originalBytesLen && originalBytesLen > 0) {
      const deltaPct = Math.round(((originalBytesLen - outLen) / originalBytesLen) * 100);
      const signText = deltaPct > 0 ? `${deltaPct} % kleiner` : deltaPct < 0 ? `${Math.abs(deltaPct)} % größer` : 'unverändert';
      stats.appendChild(el('span', {}, `Vorher: ${formatBytes(originalBytesLen)} (${signText})`));
    }

    const actions = el('div', { className: 'result-actions' });
    actions.appendChild(
      el(
        'button',
        {
          type: 'button',
          className: 'cta-button cta-button--filled',
          onClick: () => triggerBlobDownload(bytes, safeName, mime)
        },
        svgIcon('download', 18),
        'Herunterladen'
      )
    );

    if (chainable && ext === '.pdf') {
      actions.appendChild(
        el(
          'button',
          {
            type: 'button',
            className: 'cta-button',
            onClick: () => {
              if (onOpenInReader) {
                onOpenInReader({ name: safeName, bytes });
              } else {
                window.dispatchEvent(new CustomEvent('seelig:open-in-reader', { detail: { name: safeName, bytes } }));
              }
            }
          },
          'Im Reader öffnen'
        )
      );
      const chainSelect = el(
        'select',
        { 'aria-label': 'Ergebnis direkt mit anderem Werkzeug weiterverarbeiten' },
        el('option', { value: '' }, 'Weiterverarbeiten in …'),
        el('option', { value: 'compress' }, 'PDF komprimieren'),
        el('option', { value: 'protect' }, 'PDF verschlüsseln'),
        el('option', { value: 'watermark' }, 'Wasserzeichen einfügen'),
        el('option', { value: 'page-numbers' }, 'Seitenzahlen einfügen'),
        el('option', { value: 'strip-metadata' }, 'Metadaten entfernen'),
        el('option', { value: 'redact' }, 'PDF schwärzen')
      );
      chainSelect.addEventListener('change', () => {
        if (chainSelect.value) {
          onChainToTool(chainSelect.value, { name: safeName, bytes });
        }
      });
      actions.appendChild(chainSelect);
    }

    panel.append(
      el('h3', {}, 'Fertig'),
      el('p', { className: 'muted-copy' }, summary),
      stats,
      actions,
      el('p', { className: 'caption-copy' }, 'Sicherheitsnachweis: Verarbeitung lokal im Browser · 0 Bytes hochgeladen')
    );
    panel.hidden = false;
  }

  function hide() {
    panel.hidden = true;
    clear(panel);
  }

  return { element: panel, show, hide };
}
