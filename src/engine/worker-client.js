import pdfWorkerUrl from '../workers/pdf.worker.js?worker&url';
import { createTrustedWorker } from '../security/trusted-types.js';
import { WORKER_TIMEOUT_MS } from '../security/limits.js';

let activeWorker = null;
let nextId = 1;
const pending = new Map();

function resetWorker(reason = 'Worker wurde zurückgesetzt.') {
  if (activeWorker) {
    activeWorker.terminate();
    activeWorker = null;
  }
  for (const [, entry] of pending) {
    clearTimeout(entry.timer);
    entry.reject(new Error(reason));
  }
  pending.clear();
}

function getWorker() {
  if (!activeWorker) {
    activeWorker = createTrustedWorker(pdfWorkerUrl, { type: 'module' });
    activeWorker.addEventListener('message', (event) => {
      const { id, ok, result, error } = event.data || {};
      const entry = pending.get(id);
      if (!entry) return;
      clearTimeout(entry.timer);
      pending.delete(id);
      if (ok) entry.resolve(result);
      else entry.reject(new Error(error || 'Unbekannter Fehler im PDF-Worker.'));
    });
    activeWorker.addEventListener('error', (err) => {
      resetWorker(err?.message || 'PDF-Worker-Laufzeitfehler.');
    });
  }
  return activeWorker;
}

export function abortActivePdfWork() {
  resetWorker('Verarbeitung wurde abgebrochen.');
}

export function runWorkerOp(action, payload = {}, timeoutMs = WORKER_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const worker = getWorker();
    const timer = setTimeout(() => {
      pending.delete(id);
      resetWorker('Zeitlimit (60 s) überschritten – PDF-Worker wurde aus Sicherheitsgründen beendet.');
    }, timeoutMs);

    pending.set(id, { resolve, reject, timer });
    worker.postMessage({ id, action, payload });
  });
}
