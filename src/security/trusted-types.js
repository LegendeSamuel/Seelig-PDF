function installTinyfillIfNeeded() {
  if (typeof window !== 'undefined' && !window.trustedTypes) {
    window.trustedTypes = {
      createPolicy: (_name, rules) => rules
    };
  }
}

function validateSameOriginScriptUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || rawUrl.length === 0 || rawUrl.length > 2048) {
    throw new TypeError('Ungültige Worker-URL.');
  }
  const baseOrigin =
    typeof window !== 'undefined' ? window.location.origin : 'https://pdf.seelig-designs.eu';
  const parsed = new URL(rawUrl, baseOrigin);

  if (parsed.origin !== baseOrigin) {
    throw new TypeError(`Cross-Origin Worker blockiert: ${parsed.origin}`);
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new TypeError(`Ungültiges Worker-Protokoll: ${parsed.protocol}`);
  }
  if (parsed.pathname.includes('..') || parsed.pathname.includes('\\')) {
    throw new TypeError('Ungültiger Worker-Pfad.');
  }
  const allowedPath = /^\/(assets|src|node_modules)\//.test(parsed.pathname);
  const allowedExt = /\.(?:js|mjs)$/.test(parsed.pathname);
  if (!allowedPath || !allowedExt) {
    throw new TypeError(`Nicht erlaubter Worker-Pfad: ${parsed.pathname}`);
  }
  return parsed.href;
}

let workerPolicy = null;

export function getWorkerPolicy() {
  if (workerPolicy) return workerPolicy;
  installTinyfillIfNeeded();
  if (typeof window !== 'undefined' && window.trustedTypes) {
    workerPolicy = window.trustedTypes.createPolicy('seelig-worker', {
      createScriptURL: validateSameOriginScriptUrl
    });
  } else {
    workerPolicy = { createScriptURL: validateSameOriginScriptUrl };
  }
  return workerPolicy;
}

export function createTrustedScriptURL(url) {
  const str = url instanceof URL ? url.href : String(url);
  return getWorkerPolicy().createScriptURL(str);
}

export function createTrustedWorker(url, options = { type: 'module' }) {
  const trustedUrl = createTrustedScriptURL(url);
  return new Worker(trustedUrl, options);
}
