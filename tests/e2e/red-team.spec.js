import fs from 'node:fs';
import { test, expect } from '@playwright/test';
import { PDFDocument } from '@cantoo/pdf-lib';
import {
  createCleanSamplePdf,
  createCorruptPdfBytes,
  createEmbeddedJsPdf,
  createHtmlPolyglotAsPdf,
  createSvgPolyglotAsPng,
  createXssMetadataPdf
} from '../fixtures/malicious-pdfs.js';

function installRuntimeWatchers(page) {
  const unexpectedRequests = [];
  const pageErrors = [];
  const consoleErrors = [];
  const dialogs = [];

  page.on('request', (req) => {
    const u = req.url();
    const isLocal = u.startsWith('http://127.0.0.1:4173/') || u.startsWith('blob:') || u.startsWith('data:');
    if (!isLocal || req.method() !== 'GET') {
      unexpectedRequests.push(`${req.method()} ${u}`);
    }
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('dialog', async (d) => {
    dialogs.push(d.message());
    await d.dismiss();
  });

  return { unexpectedRequests, pageErrors, consoleErrors, dialogs };
}

test.describe('Red-Team & Security Verification', () => {
  test('enforces strict HTTP security headers in production preview', async ({ request }) => {
    const res = await request.get('/');
    expect(res.status()).toBe(200);
    const h = res.headers();

    expect(h['content-security-policy']).toContain("default-src 'none'");
    expect(h['content-security-policy']).toContain("script-src 'self'");
    expect(h['content-security-policy']).toContain("worker-src 'self'");
    expect(h['content-security-policy']).toContain("object-src 'none'");
    expect(h['content-security-policy']).toContain("base-uri 'none'");
    expect(h['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(h['content-security-policy']).toContain("require-trusted-types-for 'script'");
    expect(h['content-security-policy']).toContain('trusted-types seelig-worker');
    expect(h['x-frame-options']).toBe('DENY');
    expect(h['x-content-type-options']).toBe('nosniff');
    expect(h['referrer-policy']).toBe('no-referrer');
    expect(h['cross-origin-opener-policy']).toBe('same-origin');
    expect(h['cross-origin-resource-policy']).toBe('same-origin');
    expect(h['permissions-policy']).toContain('camera=()');
  });

  test('enforces Trusted Types at runtime against innerHTML & unauthorized policies', async ({ page }) => {
    await page.goto('/');
    const blocked = await page.evaluate(() => {
      let innerHtmlBlocked = false;
      let policyBlocked = false;
      try {
        const d = document.createElement('div');
        d.innerHTML = '<img src=x onerror=alert(1)>';
      } catch {
        innerHtmlBlocked = true;
      }
      try {
        window.trustedTypes.createPolicy('evil-bypass', { createHTML: (s) => s });
      } catch {
        policyBlocked = true;
      }
      return { innerHtmlBlocked, policyBlocked };
    });
    expect(blocked.innerHtmlBlocked).toBe(true);
    expect(blocked.policyBlocked).toBe(true);
  });

  test('neutralizes XSS filenames, XSS metadata, and embedded PDF /JavaScript with 0 exfiltration', async ({ page }) => {
    const w = installRuntimeWatchers(page);
    const xssPdf = await createXssMetadataPdf();
    const jsPdf = await createEmbeddedJsPdf();

    await page.goto('/#/tool/metadata-edit');
    await page.setInputFiles('#meta-pdf', {
      name: '<img src=x onerror="window.__XSS=1">.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from(xssPdf)
    });
    await expect(page.locator('#meta-title')).toHaveValue('<img src=x onerror="window.__XSS=1">');

    await page.setInputFiles('#meta-pdf', {
      name: 'embedded-js.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from(jsPdf)
    });
    await expect(page.locator('table.data-table')).toContainText('Erkannt (werden im Viewer blockiert)');

    // Also render embedded-js.pdf through PDF.js in organize & extract-text
    await page.goto('/#/tool/organize');
    await page.setInputFiles('#org-files', {
      name: 'embedded-js.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from(jsPdf)
    });
    await expect(page.locator('.page-thumb')).toHaveCount(1);

    await page.goto('/#/tool/extract-text');
    await page.setInputFiles('#ext-txt-pdf', {
      name: 'embedded-js.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from(jsPdf)
    });
    await page.getByRole('button', { name: 'Text extrahieren' }).click();
    await expect(page.locator('#ext-txt-preview')).toHaveValue(/Embedded JS Probe/);

    const xssFlag = await page.evaluate(() => window.__XSS);
    expect(xssFlag).toBeUndefined();
    expect(w.dialogs).toEqual([]);
    expect(w.unexpectedRequests).toEqual([]);
    expect(w.pageErrors).toEqual([]);
    expect(w.consoleErrors).toEqual([]);
  });

  test('rejects HTML/SVG polyglots and malformed PDFs gracefully', async ({ page }) => {
    const w = installRuntimeWatchers(page);

    await page.goto('/#/tool/merge');
    await page.setInputFiles('#merge-files', {
      name: 'polyglot.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from(createHtmlPolyglotAsPdf())
    });
    await expect(page.locator('.alert-banner--error').first()).toContainText('blockiert');

    await page.goto('/#/tool/images-to-pdf');
    await page.setInputFiles('#img2pdf-files', {
      name: 'evil-svg.png',
      mimeType: 'image/png',
      buffer: Buffer.from(createSvgPolyglotAsPng())
    });
    await expect(page.locator('.alert-banner--error').first()).toContainText('blockiert');

    await page.goto('/#/tool/split');
    await page.setInputFiles('#split-file', {
      name: 'corrupt.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from(createCorruptPdfBytes())
    });
    await page.getByRole('button', { name: 'PDF trennen' }).click();
    await expect(page.locator('.alert-banner--error').last()).toBeVisible();

    expect(await page.evaluate(() => window.__XSS)).toBeUndefined();
    expect(w.dialogs).toEqual([]);
    expect(w.unexpectedRequests).toEqual([]);
  });

  test('true pixel redaction permanently erases underlying secret text from output PDF', async ({ page }) => {
    const w = installRuntimeWatchers(page);
    const secret = 'GEHEIMCODE_998877';
    const pdfBytes = await createCleanSamplePdf({ pages: 1, title: 'Vertraulich', secretLine: secret });

    await page.setViewportSize({ width: 1440, height: 1200 });
    await page.goto('/#/tool/redact');
    await page.setInputFiles('#redact-pdf', {
      name: 'vertraulich.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from(pdfBytes)
    });

    const overlay = page.locator('.canvas-overlay-interactive');
    await expect(overlay).toBeVisible();
    await expect(page.getByText('Seite 1 von 1')).toBeVisible();
    await page.waitForFunction(() => {
      const c = document.querySelector('.canvas-stage canvas');
      return Boolean(c && c.width > 350 && c.height > 400);
    });
    await overlay.evaluate((el) => el.scrollIntoView({ behavior: 'instant', block: 'center' }));

    const box = await overlay.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box.x + 12, box.y + 12);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 12, box.y + box.height - 12);
    await page.mouse.up();

    await expect(page.locator('.stage-box--redact')).toHaveCount(1);
    await page.getByRole('button', { name: 'Unwiderruflich schwärzen' }).click();
    await expect(page.locator('.result-panel')).toBeVisible();

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Herunterladen' }).click()
    ]);
    const dlPath = await download.path();
    const outBuf = fs.readFileSync(dlPath);
    expect(outBuf.includes(secret)).toBe(false);
    const outDoc = await PDFDocument.load(outBuf);
    expect(outDoc.getPageCount()).toBe(1);
    expect(w.unexpectedRequests).toEqual([]);
    expect(w.pageErrors).toEqual([]);
  });
});
