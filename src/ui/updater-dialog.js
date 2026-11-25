import { clear, el } from './dom.js';
import {
  checkForAppUpdate,
  getDesktopAppVersion,
  installAppUpdate,
  isDesktopApp,
  openExternalUrl
} from '../platform/bridge.js';
import { BRAND } from '../brand.js';

const AUTO_UPDATE_KEY = 'seelig-pdf-auto-check-updates';

export function getAutoUpdateOptIn() {
  try {
    return localStorage.getItem(AUTO_UPDATE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function setAutoUpdateOptIn(val) {
  try {
    localStorage.setItem(AUTO_UPDATE_KEY, val ? 'true' : 'false');
  } catch {
    // ignore
  }
}

export function wireUpdaterDialog() {
  const dialog = document.getElementById('updater-dialog');
  const body = document.getElementById('updater-dialog-body');
  if (!dialog || !body) return null;

  let pendingUpdate = null;

  function renderState({ statusText, updateInfo = null, errorText = '', progress = null, progressLabel = '' }) {
    clear(body);

    const optInCheck = el('input', {
      type: 'checkbox',
      id: 'updater-opt-in',
      checked: getAutoUpdateOptIn(),
      onChange: () => setAutoUpdateOptIn(optInCheck.checked)
    });

    body.appendChild(
      el('p', { className: 'muted-copy' }, statusText)
    );

    if (errorText) {
      body.appendChild(el('div', { className: 'alert-banner alert-banner--error', role: 'alert' }, errorText));
    }

    if (updateInfo) {
      const notes = updateInfo.body?.trim() || 'Keine separaten Patchnotes hinterlegt.';
      body.appendChild(
        el(
          'div',
          { className: 'legal-note' },
          el('strong', {}, `Version ${updateInfo.version} verfügbar (aktuell: ${updateInfo.currentVersion})`),
          updateInfo.date ? el('p', { className: 'caption-copy' }, `Veröffentlicht: ${updateInfo.date}`) : null
        )
      );
      body.appendChild(el('h2', {}, 'Patchnotes'));
      body.appendChild(el('pre', { className: 'diff-pre' }, notes));
    }

    if (progress !== null) {
      const bar = el('progress', { max: 100 });
      if (typeof progress === 'number') bar.value = Math.round(progress * 100);
      body.appendChild(el('div', { className: 'progress-box' }, el('span', { className: 'muted-copy' }, progressLabel), bar));
    }

    const actions = el('div', { className: 'result-actions' });
    if (updateInfo && pendingUpdate) {
      actions.appendChild(
        el(
          'button',
          {
            type: 'button',
            className: 'cta-button cta-button--filled',
            onClick: async () => {
              try {
                await installAppUpdate(pendingUpdate, (frac, lbl) => {
                  renderState({
                    statusText: 'Update wird heruntergeladen und kryptografisch geprüft …',
                    updateInfo,
                    progress: frac === null ? 0.5 : frac,
                    progressLabel: lbl
                  });
                });
              } catch (err) {
                renderState({
                  statusText: 'Update konnte nicht installiert werden.',
                  updateInfo,
                  errorText: err instanceof Error ? err.message : 'Unbekannter Update-Fehler.'
                });
              }
            }
          },
          'Jetzt aktualisieren'
        )
      );
    }

    actions.appendChild(
      el(
        'button',
        {
          type: 'button',
          className: 'cta-button cta-button--ghost',
          onClick: () => runManualCheck()
        },
        'Erneut prüfen'
      )
    );

    actions.appendChild(
      el(
        'button',
        {
          type: 'button',
          className: 'cta-button cta-button--ghost',
          onClick: () => openExternalUrl(BRAND.githubReleasesUrl)
        },
        'GitHub Releases öffnen'
      )
    );

    actions.appendChild(
      el(
        'button',
        {
          type: 'button',
          className: 'cta-button cta-button--ghost',
          onClick: () => dialog.close()
        },
        'Später'
      )
    );

    body.appendChild(actions);
    body.appendChild(
      el(
        'label',
        { htmlFor: 'updater-opt-in', className: 'choice-row' },
        optInCheck,
        'Beim Start automatisch nach neuen Versionen suchen (Installation erst nach deiner Bestätigung)'
      )
    );
  }

  async function runManualCheck({ openIfAvailableOnly = false } = {}) {
    if (!isDesktopApp()) {
      renderState({
        statusText: `In der Web-App auf ${BRAND.domain} nutzt du automatisch immer die neueste Version. Für Windows findest du alle signierten Releases auf GitHub.`
      });
      if (!openIfAvailableOnly) dialog.showModal();
      return;
    }

    const ver = await getDesktopAppVersion();
    if (!openIfAvailableOnly) {
      renderState({ statusText: `Installierte Version ${ver} · Suche auf GitHub nach Updates …`, progress: 0.2, progressLabel: 'Verbindung wird geprüft …' });
      dialog.showModal();
    }

    try {
      const res = await checkForAppUpdate();
      if (!res.available) {
        pendingUpdate = null;
        if (!openIfAvailableOnly) {
          renderState({ statusText: `Du nutzt bereits die aktuelle Version (${ver}).` });
        }
        return;
      }
      pendingUpdate = res.rawUpdate;
      renderState({
        statusText: 'Ein neues, signiertes Update liegt auf GitHub bereit. Die Installation startet erst nach deiner Bestätigung.',
        updateInfo: res
      });
      if (!dialog.open) dialog.showModal();
    } catch (err) {
      if (!openIfAvailableOnly) {
        renderState({
          statusText: `Installierte Version: ${ver}`,
          errorText: `Update-Prüfung nicht möglich (${err instanceof Error ? err.message : 'Offline oder noch kein Release signiert'}).`
        });
      }
    }
  }

  return {
    openDialog: () => runManualCheck({ openIfAvailableOnly: false }),
    maybeAutoCheckOnStart: () => {
      if (isDesktopApp() && getAutoUpdateOptIn()) {
        runManualCheck({ openIfAvailableOnly: true });
      }
    }
  };
}
