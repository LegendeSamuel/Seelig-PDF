import { defineConfig } from 'vite';
import os from 'node:os';
import path from 'node:path';

const PRODUCTION_CSP_META = [
  "default-src 'none'",
  "script-src 'self'",
  "worker-src 'self'",
  "style-src 'self'",
  "font-src 'self'",
  "img-src 'self' blob: data:",
  "connect-src 'self' blob:",
  "form-action 'none'",
  "base-uri 'none'",
  "object-src 'none'",
  "require-trusted-types-for 'script'",
  "trusted-types seelig-worker"
].join('; ');

function injectProductionCspPlugin() {
  return {
    name: 'seelig-production-csp',
    apply: 'build',
    transformIndexHtml(html) {
      const metaTag = `<meta http-equiv="Content-Security-Policy" content="${PRODUCTION_CSP_META}">`;
      return html.replace('<head>', `<head>\n  ${metaTag}`);
    }
  };
}

export default defineConfig({
  cacheDir: path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'seelig-pdf-vite-cache'),
  plugins: [injectProductionCspPlugin()],
  worker: {
    format: 'es'
  },
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
    sourcemap: false
  }
});
