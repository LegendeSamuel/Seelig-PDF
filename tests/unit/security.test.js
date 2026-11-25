import { describe, expect, it } from 'vitest';
import { validateImageBytes, validatePdfBytes, validateTextBytes } from '../../src/security/file-guard.js';
import { generateSecurePassword, parsePageRanges, sanitizeDisplayText, sanitizeFilename } from '../../src/security/sanitize.js';
import { createTrustedScriptURL } from '../../src/security/trusted-types.js';
import {
  createCleanSamplePdf,
  createHtmlPolyglotAsPdf,
  createMinimalValidPng,
  createPeExecutableAsPdf,
  createSvgPolyglotAsPng
} from '../fixtures/malicious-pdfs.js';

describe('Security Guards & Sanitizers', () => {
  it('accepts valid PDF bytes and rejects polyglots and executables', async () => {
    const valid = await createCleanSamplePdf();
    expect(() => validatePdfBytes(valid, 'ok.pdf')).not.toThrow();

    expect(() => validatePdfBytes(createHtmlPolyglotAsPdf(), 'evil.pdf')).toThrow(/blockiert|Polyglot/i);
    expect(() => validatePdfBytes(createPeExecutableAsPdf(), 'malware.pdf')).toThrow(/blockiert/i);
    expect(() => validatePdfBytes(new Uint8Array(20).fill(65), 'junk.pdf')).toThrow(/PDF-Header/i);
  });

  it('rejects SVG-with-script masquerading as PNG and accepts valid PNG', () => {
    expect(() => validateImageBytes(createSvgPolyglotAsPng(), 'evil.png')).toThrow(/blockiert/i);
    const pngInfo = validateImageBytes(createMinimalValidPng(), 'pixel.png');
    expect(pngInfo.format).toBe('png');
  });

  it('rejects NUL bytes in text files and accepts valid UTF-8', () => {
    expect(() => validateTextBytes(new Uint8Array([65, 0, 66]), 'bad.txt')).toThrow(/NUL/);
    const decoded = validateTextBytes(new TextEncoder().encode('# Hallo Seelig'), 'note.md');
    expect(decoded).toBe('# Hallo Seelig');
  });

  it('sanitizes malicious filenames including path traversal and bidi overrides', () => {
    expect(sanitizeFilename('../../<img src=x onerror=alert(1)>.exe.pdf', '.pdf')).toBe('img-src=x-onerror=alert-1.pdf');
    expect(sanitizeFilename('\u202Efdp.exe', '.pdf')).toBe('fdp.pdf');
    expect(sanitizeFilename('', '.zip')).toBe('dokument.zip');
  });

  it('strips control chars and bidi overrides in display text', () => {
    expect(sanitizeDisplayText('Hallo\u202E\x07Welt')).toBe('Hallo Welt');
  });

  it('parses page ranges safely and rejects invalid bounds', () => {
    expect(parsePageRanges('1-3, 5', 6)).toEqual([0, 1, 2, 4]);
    expect(() => parsePageRanges('0', 5)).toThrow();
    expect(() => parsePageRanges('3-2', 5)).toThrow();
    expect(() => parsePageRanges('99', 5)).toThrow();
    expect(() => parsePageRanges('1;alert(1)', 5)).toThrow();
  });

  it('generates unbiased secure passwords with requested length and entropy', () => {
    const pwd = generateSecurePassword({ length: 20, upper: true, lower: true, digits: true, symbols: true });
    expect(pwd).toHaveLength(20);
    expect(/[A-Z]/.test(pwd)).toBe(true);
    expect(/[a-z]/.test(pwd)).toBe(true);
    expect(/[2-9]/.test(pwd)).toBe(true);
  });

  it('enforces same-origin script URL allowlist in Trusted Types policy', () => {
    expect(() => createTrustedScriptURL('https://evil.example/payload.js')).toThrow(TypeError);
    expect(() => createTrustedScriptURL('data:text/javascript,alert(1)')).toThrow(TypeError);
    expect(() => createTrustedScriptURL('/assets/pdf.worker.mjs')).not.toThrow();
  });
});
