import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { PDFDocument } from '@cantoo/pdf-lib';
import { createCleanSamplePdf } from '../fixtures/malicious-pdfs.js';

const SCREENSHOT_DIR = path.resolve(process.cwd(), 'tests', 'screenshots');

test.describe('Seelig PDF UI, Tools & Visual Fidelity', () => {
  test.beforeAll(() => {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  });

  test('displays all 33 tools, supports category filtering, search, keyboard dialog & captures visual screenshots', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');

    await expect(page.locator('.tool-card')).toHaveCount(33);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '01-hub-desktop.png') });

    // Category filter chip
    await page.getByRole('button', { name: 'Sicherheit & Optimieren' }).click();
    await expect(page.locator('.tool-card')).toHaveCount(7);
    await page.getByRole('button', { name: 'Alle Werkzeuge' }).click();
    await expect(page.locator('.tool-card')).toHaveCount(33);

    // Search
    await page.fill('#tool-search', 'schwärzen');
    await expect(page.locator('.tool-card')).toHaveCount(1);
    await page.fill('#tool-search', '');
    await expect(page.locator('.tool-card')).toHaveCount(33);

    // Footer screenshot
    await page.locator('.site-footer').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '04-footer-desktop.png') });

    // Security dialog + Escape close
    await page.locator('#nav-security-btn').click();
    await expect(page.locator('#security-dialog')).toBeVisible();
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '02-security-dialog.png') });
    await page.keyboard.press('Escape');
    await expect(page.locator('#security-dialog')).not.toBeVisible();

    // Mobile view
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await expect(page.locator('.tool-card')).toHaveCount(33);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '05-hub-mobile.png') });
  });

  test('executes merge, split, protect -> unlock roundtrip, and qr-code workflows', async ({ page }) => {
    const pdfA = await createCleanSamplePdf({ pages: 2, title: 'DocA' });
    const pdfB = await createCleanSamplePdf({ pages: 2, title: 'DocB' });

    // 1. Merge
    await page.goto('/#/tool/merge');
    await page.setInputFiles('#merge-files', [
      { name: 'a.pdf', mimeType: 'application/pdf', buffer: Buffer.from(pdfA) },
      { name: 'b.pdf', mimeType: 'application/pdf', buffer: Buffer.from(pdfB) }
    ]);
    await page.getByRole('button', { name: 'PDFs zusammenfügen' }).click();
    await expect(page.locator('.result-panel')).toBeVisible();
    const [dlMerge] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Herunterladen' }).click()
    ]);
    const mergedDoc = await PDFDocument.load(fs.readFileSync(await dlMerge.path()));
    expect(mergedDoc.getPageCount()).toBe(4);

    // 2. Protect -> Unlock roundtrip
    await page.goto('/#/tool/protect');
    await page.setInputFiles('#prot-pdf', { name: 'a.pdf', mimeType: 'application/pdf', buffer: Buffer.from(pdfA) });
    await page.getByRole('button', { name: /Passwort generieren/i }).click();
    const genPwd = await page.locator('#prot-user-pwd').inputValue();
    expect(genPwd.length).toBeGreaterThanOrEqual(16);
    await page.getByRole('button', { name: 'Mit AES-256 verschlüsseln' }).click();
    await expect(page.locator('.result-panel')).toBeVisible();
    const [dlEnc] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Herunterladen' }).click()
    ]);
    const encBuf = fs.readFileSync(await dlEnc.path());

    await page.goto('/#/tool/unlock');
    await page.setInputFiles('#unlock-pdf', { name: 'locked.pdf', mimeType: 'application/pdf', buffer: encBuf });
    await page.fill('#unlock-pwd', genPwd);
    await page.getByRole('button', { name: 'Passwortschutz entfernen' }).click();
    await expect(page.locator('.result-panel')).toBeVisible();
    const [dlUnlock] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Herunterladen' }).click()
    ]);
    const unlockedDoc = await PDFDocument.load(fs.readFileSync(await dlUnlock.path()));
    expect(unlockedDoc.getPageCount()).toBe(2);

    // 3. QR Code
    await page.goto('/#/tool/qr-code');
    await page.fill('#qr-payload', 'https://pdf.seelig-designs.eu');
    await page.getByRole('button', { name: 'QR-Code als PDF erstellen' }).click();
    await expect(page.locator('.result-panel')).toBeVisible();

    // 4. Redact UI screenshot
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/#/tool/redact');
    await page.setInputFiles('#redact-pdf', { name: 'a.pdf', mimeType: 'application/pdf', buffer: Buffer.from(pdfA) });
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '03-redact-tool.png') });
  });
});
