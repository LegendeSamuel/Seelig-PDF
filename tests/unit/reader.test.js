import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { buildSpreadLayout } from '../../src/reader/pdf-viewport.js';
import { searchPdfDocument } from '../../src/reader/search.js';
import { computeDocHash, createReaderTabStore } from '../../src/reader/tab-store.js';

describe('Brand configuration & White-Label invariants', () => {
  it('defines complete Seelig PDF branding without Typekit or Sofia Pro', () => {
    const raw = fs.readFileSync(path.resolve(process.cwd(), 'brand/brand.config.json'), 'utf8');
    expect(raw).not.toMatch(/sofia[-_ ]?pro|use\.typekit\.net/i);
    const cfg = JSON.parse(raw);
    expect(cfg.appName).toBe('Seelig PDF');
    expect(cfg.domain).toBe('pdf.seelig-designs.eu');
    expect(cfg.githubRepo).toMatch(/^https:\/\/github\.com\/LegendeSamuel\/Seelig-PDF$/);
    expect(cfg.assets?.markLight).toBe('/assets/brand/mark-white.svg');
  });
});

describe('Reader spread layout', () => {
  it('computes single, two-page and book spreads correctly', () => {
    expect(buildSpreadLayout(0, 'single')).toEqual([]);
    expect(buildSpreadLayout(3, 'single')).toEqual([[1], [2], [3]]);
    expect(buildSpreadLayout(4, 'two-page')).toEqual([[1, 2], [3, 4]]);
    expect(buildSpreadLayout(5, 'two-page')).toEqual([[1, 2], [3, 4], [5]]);
    expect(buildSpreadLayout(1, 'book')).toEqual([[1]]);
    expect(buildSpreadLayout(5, 'book')).toEqual([[1], [2, 3], [4, 5]]);
    expect(buildSpreadLayout(4, 'book')).toEqual([[1], [2, 3], [4]]);
  });
});

describe('Reader tab store & hashing', () => {
  it('manages tabs, deduplicates matching filePaths, and falls back cleanly on close', () => {
    const store = createReaderTabStore();
    const bytesA = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);
    const bytesB = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x32]);

    const t1 = store.openTab({ name: 'a.pdf', bytes: bytesA, filePath: 'C:\\docs\\a.pdf' });
    const t2 = store.openTab({ name: 'b.pdf', bytes: bytesB, filePath: 'C:\\docs\\b.pdf' });
    expect(store.state.tabs).toHaveLength(2);
    expect(store.state.activeTabId).toBe(t2.id);

    const dup = store.openTab({ name: 'a.pdf', bytes: bytesA, filePath: 'C:\\docs\\a.pdf' });
    expect(dup.id).toBe(t1.id);
    expect(store.state.tabs).toHaveLength(2);
    expect(store.state.activeTabId).toBe(t1.id);

    store.setSplitMode('two-tabs');
    expect(store.state.splitSecondTabId).toBe(t2.id);

    store.closeTab(t2.id);
    expect(store.state.tabs).toHaveLength(1);
    expect(store.state.splitMode).toBe('same-doc');

    store.closeTab(t1.id);
    expect(store.state.tabs).toHaveLength(0);
    expect(store.state.activeTabId).toBeNull();
    expect(store.state.splitMode).toBe('off');
  });

  it('produces deterministic SHA-256 document hashes', async () => {
    const a = new TextEncoder().encode('%PDF-1.7 sample');
    const b = new TextEncoder().encode('%PDF-1.7 other!');
    const hashA1 = await computeDocHash(a);
    const hashA2 = await computeDocHash(a);
    const hashB = await computeDocHash(b);
    expect(hashA1).toBe(hashA2);
    expect(hashA1).not.toBe(hashB);
    expect(hashA1).toMatch(/^\d+-[0-9a-f]{24}$/);
  });
});

describe('Reader full-text search', () => {
  it('finds case-insensitive matches across multiple pages and cleans up every page', async () => {
    const cleanups = [vi.fn(), vi.fn()];
    const mockPdf = {
      numPages: 2,
      async getPage(num) {
        return {
          async getTextContent() {
            if (num === 1) {
              return { items: [{ str: 'Hallo Seelig Welt seelig' }, { str: 'Andere Zeile' }] };
            }
            return { items: [{ str: 'SEELIG Designs PDF' }] };
          },
          cleanup: cleanups[num - 1]
        };
      }
    };

    expect(await searchPdfDocument(mockPdf, '   ')).toEqual({ query: '', matches: [] });

    const res = await searchPdfDocument(mockPdf, 'Seelig');
    expect(res.query).toBe('Seelig');
    expect(res.matches).toEqual([
      { pageNumber: 1, itemIndex: 0, offset: 6, length: 6 },
      { pageNumber: 1, itemIndex: 0, offset: 18, length: 6 },
      { pageNumber: 2, itemIndex: 0, offset: 0, length: 6 }
    ]);
    expect(cleanups[0]).toHaveBeenCalledTimes(1);
    expect(cleanups[1]).toHaveBeenCalledTimes(1);
  });
});
