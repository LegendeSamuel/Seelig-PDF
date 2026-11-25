import { triggerBlobDownload } from '../ui/result-panel.js';
import { sanitizeFilename } from '../security/sanitize.js';

export function isDesktopApp() {
  return typeof window !== 'undefined' && Boolean(window.__TAURI_INTERNALS__);
}

export async function getDesktopAppVersion() {
  if (!isDesktopApp()) return 'Web';
  const { getVersion } = await import('@tauri-apps/api/app');
  return getVersion();
}

export async function openPdfFilesFromDesktopDialog() {
  if (!isDesktopApp()) return [];
  const { invoke } = await import('@tauri-apps/api/core');
  const results = await invoke('pick_open_pdfs');
  return (results || []).map((item) => ({
    name: item.name,
    filePath: item.path,
    bytes: new Uint8Array(item.bytes)
  }));
}

export async function consumeLaunchFiles() {
  if (!isDesktopApp()) return [];
  const { invoke } = await import('@tauri-apps/api/core');
  const paths = await invoke('consume_launch_files');
  const loaded = [];
  for (const p of paths || []) {
    try {
      const item = await invoke('read_allowed_pdf', { path: p });
      loaded.push({
        name: item.name,
        filePath: item.path,
        bytes: new Uint8Array(item.bytes)
      });
    } catch {
      // Ignore unreadable or non-PDF launch arguments
    }
  }
  return loaded;
}

export async function subscribeExternalFileOpen(onFiles) {
  if (!isDesktopApp()) return () => {};
  const { listen } = await import('@tauri-apps/api/event');
  const { invoke } = await import('@tauri-apps/api/core');
  const unlisten = await listen('seelig://open-files', async (event) => {
    const paths = Array.isArray(event.payload) ? event.payload : [];
    const loaded = [];
    for (const p of paths) {
      try {
        const item = await invoke('read_allowed_pdf', { path: p });
        loaded.push({
          name: item.name,
          filePath: item.path,
          bytes: new Uint8Array(item.bytes)
        });
      } catch {
        // Ignore invalid path
      }
    }
    if (loaded.length > 0) onFiles(loaded);
  });
  return unlisten;
}

export async function savePdfFile({ bytes, defaultName = 'dokument.pdf', existingPath = null, forceSaveAs = false }) {
  const safeName = sanitizeFilename(defaultName, '.pdf');
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);

  if (!isDesktopApp()) {
    triggerBlobDownload(data, safeName, 'application/pdf');
    return { saved: true, path: null, name: safeName };
  }

  const { invoke } = await import('@tauri-apps/api/core');
  if (existingPath && !forceSaveAs) {
    const res = await invoke('save_pdf_overwrite', {
      path: existingPath,
      bytes: Array.from(data)
    });
    return { saved: true, path: res.path, name: res.name };
  }

  const res = await invoke('save_pdf_as', {
    defaultName: safeName,
    bytes: Array.from(data)
  });
  if (!res) return { saved: false, path: existingPath, name: safeName };
  return { saved: true, path: res.path, name: res.name };
}

export async function openExternalUrl(url) {
  if (!isDesktopApp()) {
    window.open(url, '_blank', 'noopener,noreferrer');
    return;
  }
  const { openUrl } = await import('@tauri-apps/plugin-opener');
  await openUrl(url);
}

export async function checkForAppUpdate() {
  if (!isDesktopApp()) {
    return { supported: false, available: false, reason: 'Nur in der Desktop-App verfügbar.' };
  }
  const { check } = await import('@tauri-apps/plugin-updater');
  const update = await check();
  if (!update) {
    return { supported: true, available: false };
  }
  return {
    supported: true,
    available: true,
    version: update.version,
    currentVersion: update.currentVersion,
    date: update.date || '',
    body: update.body || '',
    rawUpdate: update
  };
}

export async function installAppUpdate(rawUpdate, onProgress = () => {}) {
  if (!isDesktopApp() || !rawUpdate) return;
  let downloaded = 0;
  let total = 0;
  await rawUpdate.downloadAndInstall((event) => {
    if (event.event === 'Started') {
      total = event.data?.contentLength || 0;
      onProgress(0, 'Download gestartet …');
    } else if (event.event === 'Progress') {
      downloaded += event.data?.chunkLength || 0;
      const frac = total > 0 ? Math.min(1, downloaded / total) : null;
      onProgress(frac, 'Update wird geladen …');
    } else if (event.event === 'Finished') {
      onProgress(1, 'Signatur geprüft, wird installiert …');
    }
  });
}
