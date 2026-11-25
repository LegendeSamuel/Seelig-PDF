import { MAX_PAGES } from './limits.js';

const BIDI_AND_CONTROL_RE = /[\u0000-\u001F\u007F\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;

export function sanitizeDisplayText(value, maxLen = 200) {
  if (value === null || value === undefined) return '';
  const cleaned = String(value).replace(BIDI_AND_CONTROL_RE, ' ').replace(/\s+/g, ' ').trim();
  if (cleaned.length <= maxLen) return cleaned;
  return cleaned.slice(0, maxLen - 1) + '…';
}

export function sanitizeFilename(rawName, forcedExt = '.pdf') {
  const baseInput = String(rawName || 'dokument');
  // Strip path prefixes (Unix & Windows)
  const leaf = baseInput.split(/[\\/]/).pop() || 'dokument';
  // Remove bidi overrides, control chars, unsafe HTML/shell characters
  let clean = leaf
    .replace(BIDI_AND_CONTROL_RE, '')
    .replace(/[<>:"/\\|?*&'`$!#;{}[\]()]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/\.+$/g, '');

  // Strip trailing known extensions or forcedExt so user cannot disguise .exe/.html
  const extLower = forcedExt.toLowerCase();
  if (clean.toLowerCase().endsWith(extLower)) {
    clean = clean.slice(0, -extLower.length);
  }
  clean = clean.replace(/\.(pdf|html?|svg|js|exe|bat|cmd|ps1|png|jpe?g|webp|zip|txt|md)$/i, '');
  clean = clean.replace(/^\.+/, '').replace(/-+/g, '-').replace(/^-|-$/g, '');

  if (!clean) clean = 'dokument';
  if (clean.length > 80) clean = clean.slice(0, 80);
  return `${clean}${forcedExt}`;
}

export function parsePageRanges(input, pageCount) {
  if (!Number.isInteger(pageCount) || pageCount < 1 || pageCount > MAX_PAGES) {
    throw new Error('Ungültige Seitenzahl des Dokuments.');
  }
  const raw = String(input || '').trim();
  if (!raw) {
    throw new Error('Bitte gib mindestens eine Seite oder einen Bereich an (z. B. 1-3, 5).');
  }
  const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) {
    throw new Error('Keine gültigen Seitenangaben erkannt.');
  }

  const indices = [];
  for (const part of parts) {
    const rangeMatch = /^(\d{1,4})\s*-\s*(\d{1,4})$/.exec(part);
    if (rangeMatch) {
      const start = Number(rangeMatch[1]);
      const end = Number(rangeMatch[2]);
      if (start < 1 || end < 1 || start > pageCount || end > pageCount || start > end) {
        throw new Error(`Ungültiger Seitenbereich „${part}“ (Dokument hat ${pageCount} Seiten).`);
      }
      for (let p = start; p <= end; p++) {
        indices.push(p - 1);
        if (indices.length > MAX_PAGES) {
          throw new Error(`Maximal ${MAX_PAGES} Ausgabeseiten erlaubt.`);
        }
      }
      continue;
    }

    const singleMatch = /^(\d{1,4})$/.exec(part);
    if (singleMatch) {
      const p = Number(singleMatch[1]);
      if (p < 1 || p > pageCount) {
        throw new Error(`Seite ${p} existiert nicht (Dokument hat ${pageCount} Seiten).`);
      }
      indices.push(p - 1);
      if (indices.length > MAX_PAGES) {
        throw new Error(`Maximal ${MAX_PAGES} Ausgabeseiten erlaubt.`);
      }
      continue;
    }

    throw new Error(`Ungültiger Ausdruck „${sanitizeDisplayText(part, 24)}“. Erlaubt sind Zahlen und Bereiche wie 1-3, 5.`);
  }

  return indices;
}

function secureRandomInt(maxExclusive) {
  if (maxExclusive <= 1) return 0;
  const limit = Math.floor(0x1_0000_0000 / maxExclusive) * maxExclusive;
  const buf = new Uint32Array(1);
  while (true) {
    crypto.getRandomValues(buf);
    if (buf[0] < limit) {
      return buf[0] % maxExclusive;
    }
  }
}

export function generateSecurePassword({
  length = 16,
  upper = true,
  lower = true,
  digits = true,
  symbols = true
} = {}) {
  const safeLen = Math.max(8, Math.min(64, Math.trunc(Number(length) || 16)));
  const sets = [];
  if (upper) sets.push('ABCDEFGHJKLMNPQRSTUVWXYZ');
  if (lower) sets.push('abcdefghijkmnopqrstuvwxyz');
  if (digits) sets.push('23456789');
  if (symbols) sets.push('!@#$%&*+-_=?.');
  if (sets.length === 0) {
    sets.push('abcdefghijkmnopqrstuvwxyz', '23456789');
  }

  const allChars = sets.join('');
  const chars = [];
  for (const s of sets) {
    if (chars.length < safeLen) {
      chars.push(s[secureRandomInt(s.length)]);
    }
  }
  while (chars.length < safeLen) {
    chars.push(allChars[secureRandomInt(allChars.length)]);
  }
  // Fisher-Yates shuffle with rejection-sampled CSPRNG
  for (let i = chars.length - 1; i > 0; i--) {
    const j = secureRandomInt(i + 1);
    const tmp = chars[i];
    chars[i] = chars[j];
    chars[j] = tmp;
  }
  return chars.join('');
}

export function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1).replace('.', ',')} KB`;
  return `${(n / (1024 * 1024)).toFixed(2).replace('.', ',')} MB`;
}
