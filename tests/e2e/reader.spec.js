import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { createCleanSamplePdf } from '../fixtures/malicious-pdfs.js';

const SCREENSHOT_DIR = path.resolve(process.cwd(), 'tests', 'screenshots');

test.describe('Seelig PDF Reader, Split-View, Search, Handoff & Security', () => {
  test.beforeAll(() => {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  });

  test('opens multi-tab PDFs, renders safely without XSS, searches, switches modes, hands off & captures screenshots', async ({ page }) => {
    const externalRequests = [];
    const errors = [];

    page.on('request', (req) => {
      const url = req.url();
      if (!url.startsWith('http://127.0.0.1:4173/') && !url.startsWith('blob:') && !url.startsWith('data:')) {
        externalRequests.push(url);
      }
    });
    page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text();
        if (/Content Security Policy|TrustedScriptURL|Trusted Type|unsafe/i.test(text)) {
          errors.push(`console.error: ${text}`);
        }
      }
    });

    const alphaPdf = await createCleanSamplePdf({
      pages: 3,
      title: 'Alpha Bericht',
      secretLine: 'Seelig Alpha Testtext'
    });
    const xssPdf = await createCleanSamplePdf({
      pages: 1,
      title: 'XSS Probe',
      secretLine: '<img src=x onerror="window.__XSS=77"> Seelig Bravo'
    });

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/#/reader');
    await expect(page.locator('#reader-heading')).toBeAttached();

    // Upload 2 PDFs -> opens 2 tabs
    await page.setInputFiles('#reader-open-input', [
      { name: 'alpha.pdf', mimeType: 'application/pdf', buffer: Buffer.from(alphaPdf) },
      { name: 'xss.pdf', mimeType: 'application/pdf', buffer: Buffer.from(xssPdf) }
    ]);

    const tabs = page.locator('.reader-tablist [role="tab"]');
    await expect(tabs).toHaveCount(2);

    // Wait for active PDF (xss.pdf) canvas & safe text layer to render
    await expect(page.locator('.reader-page-canvas').first()).toBeVisible();
    await page.waitForFunction(() => {
      const spans = document.querySelectorAll('.reader-text-layer span');
      return Array.from(spans).some((s) => s.textContent.includes('Seelig Bravo'));
    });

    const xssTriggered = await page.evaluate(() => window.__XSS);
    expect(xssTriggered).toBeUndefined();

    // Switch back to alpha.pdf tab and verify 3 thumbnails + desktop screenshot
    await tabs.first().click();
    await expect(tabs.first()).toHaveAttribute('aria-selected', 'true');
    await page.waitForFunction(() => {
      const spans = document.querySelectorAll('.reader-text-layer span');
      return Array.from(spans).some((s) => s.textContent.includes('Seelig Alpha Testtext'));
    });
    await expect(page.locator('.sidebar-thumb-btn')).toHaveCount(3);

    // Assert zero outer page scrolling & full-width fluid Reader layout
    const layoutMetrics = await page.evaluate(() => {
      const bodyRect = document.querySelector('.reader-body')?.getBoundingClientRect();
      return {
        docScrollH: document.documentElement.scrollHeight,
        innerH: window.innerHeight,
        bodyWidth: bodyRect?.width || 0,
        innerW: window.innerWidth
      };
    });
    expect(layoutMetrics.docScrollH).toBeLessThanOrEqual(layoutMetrics.innerH + 1);
    expect(layoutMetrics.bodyWidth).toBeGreaterThanOrEqual(layoutMetrics.innerW - 2);

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '06-reader-desktop.png') });

    // Verify top-left Adobe/Apple-style menubar, hover-switching, keyboard ArrowRight & Vollansicht
    await page.locator('#menu-view-trigger').click();
    await expect(page.locator('#menu-view-trigger')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#menu-view')).toBeVisible();
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '09-reader-menubar-open.png') });

    // Hover switches directly from Ansicht to Datei when open
    await page.locator('#menu-file-trigger').hover();
    await expect(page.locator('#menu-file-trigger')).toHaveAttribute('aria-expanded', 'true');
    // Keyboard ArrowRight switches back to Ansicht preview
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#menu-view-trigger')).toHaveAttribute('aria-expanded', 'true');

    // Click Vollansicht inside Ansicht menu -> hides topbar/toolbar cleanly & Esc restores
    await page.locator('[data-menu-action="view-fullscreen"]').click();
    await expect(page.locator('html.is-fullscreen-reading')).toHaveCount(1);
    await expect(page.locator('.app-topbar')).toBeHidden();
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '10-reader-fullscreen.png') });
    await page.keyboard.press('Escape');
    await expect(page.locator('html.is-fullscreen-reading')).toHaveCount(0);
    await expect(page.locator('.app-topbar')).toBeVisible();

    // Full-document Ctrl+F search with highlighted <mark>
    await page.keyboard.press('Control+f');
    await expect(page.locator('#reader-search-input')).toBeVisible();
    await page.fill('#reader-search-input', 'Alpha');
    await expect(page.locator('.reader-text-layer mark.reader-match')).toHaveCount(1);

    // Sidebar bookmarks tab roundtrip
    await page.getByRole('tab', { name: 'Lesezeichen' }).click();
    await expect(page.locator('.reader-sidebar-scroll')).toContainText('Keine Lesezeichen');
    await page.getByRole('tab', { name: 'Seiten' }).click();
    await expect(page.locator('.sidebar-thumb-btn')).toHaveCount(3);

    // Reading mode Night + Two-Page + Split-View
    await page.selectOption('select[aria-label="Lesemodus wählen"]', 'night');
    await expect(page.locator('.reader-pages-host').first()).toHaveAttribute('data-reading-mode', 'night');
    await page.selectOption('select[aria-label="Seitenlayout wählen"]', 'two-page');
    await page.getByRole('button', { name: 'Split-View' }).click();
    const visiblePanes = page.locator('.reader-pane:not([hidden])');
    await expect(visiblePanes).toHaveCount(2);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '07-reader-split-night.png') });

    // Reset Split-View back to single pane + original theme + single layout for mobile check
    while ((await page.getByRole('button', { name: 'Split-View' }).getAttribute('aria-pressed')) !== 'false') {
      await page.getByRole('button', { name: 'Split-View' }).click();
    }
    await expect(visiblePanes).toHaveCount(1);
    await page.selectOption('select[aria-label="Lesemodus wählen"]', 'original');
    await page.selectOption('select[aria-label="Seitenlayout wählen"]', 'single');

    // Mobile responsive layout
    await page.setViewportSize({ width: 390, height: 844 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    expect(overflow).toBe(false);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '08-reader-mobile.png') });

    // Back to desktop and verify 1-click tool handoff -> compress -> Im Reader öffnen
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.selectOption('select[aria-label="Geöffnete PDF in Werkzeug bearbeiten"]', 'compress');
    await expect(page).toHaveURL(/#\/tool\/compress$/);
    await page.getByRole('button', { name: 'PDF komprimieren' }).click();
    await expect(page.locator('.result-panel')).toBeVisible();
    await page.getByRole('button', { name: 'Im Reader öffnen' }).click();
    await expect(page).toHaveURL(/#\/reader$/);
    await expect(tabs).toHaveCount(3);

    // Updates button is hidden in Web mode; GitHub Releases banner is visible on Hub
    await expect(page.locator('#nav-updates-btn')).toBeHidden();
    await page.goto('/#/');
    const ghLink = page.locator('#app-root a[href="https://github.com/LegendeSamuel/Seelig-PDF/releases"]').first();
    await expect(ghLink).toBeVisible();

    expect(externalRequests).toEqual([]);
    expect(errors).toEqual([]);
  });
});
