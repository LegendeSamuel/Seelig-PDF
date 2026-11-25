import { MAX_BATCH_BYTES, MAX_FILE_BYTES, MAX_FILES, MAX_NESTING_DEPTH, MAX_TEXT_BYTES } from './limits.js';

const FORBIDDEN_POLYGLOT_PREFIXES = [
  '<html',
  '<!doctype',
  '<script',
  '<svg',
  '<?xml',
  '<?php',
  '<iframe',
  '<object'
];

function asciiLower(bytes, start, length) {
  const slice = bytes.subarray(start, Math.min(bytes.length, start + length));
  let out = '';
  for (let i = 0; i < slice.length; i++) {
    const c = slice[i];
    out += c >= 65 && c <= 90 ? String.fromCharCode(c + 32) : String.fromCharCode(c);
  }
  return out;
}

function hasExecutableSignature(bytes) {
  if (bytes.length >= 2 && bytes[0] === 0x4d && bytes[1] === 0x5a) return true; // MZ (PE/DOS)
  if (bytes.length >= 4 && bytes[0] === 0x7f && bytes[1] === 0x45 && bytes[2] === 0x4c && bytes[3] === 0x46) {
    return true; // ELF
  }
  return false;
}

function hasForbiddenMarkupPrefix(bytes) {
  const head = asciiLower(bytes, 0, 512).replace(/^\uFEFF/, '').trimStart();
  return FORBIDDEN_POLYGLOT_PREFIXES.some((prefix) => head.startsWith(prefix));
}

function findPdfHeaderOffset(bytes) {
  const limit = Math.min(bytes.length, 1024);
  for (let i = 0; i <= limit - 7; i++) {
    if (
      bytes[i] === 0x25 && // %
      bytes[i + 1] === 0x50 && // P
      bytes[i + 2] === 0x44 && // D
      bytes[i + 3] === 0x46 && // F
      bytes[i + 4] === 0x2d && // -
      (bytes[i + 5] === 0x31 || bytes[i + 5] === 0x32) &&
      bytes[i + 6] === 0x2e
    ) {
      return i;
    }
  }
  return -1;
}

function checkBracketNesting(bytes) {
  const scanLen = Math.min(bytes.length, 256 * 1024);
  let arrayDepth = 0;
  let dictDepth = 0;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < scanLen; i++) {
    const b = bytes[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (b === 0x5c && inString) {
      escaped = true;
      continue;
    }
    if (b === 0x28) inString = true;
    else if (b === 0x29) inString = false;
    if (inString) continue;

    if (b === 0x5b) {
      arrayDepth++;
      if (arrayDepth > MAX_NESTING_DEPTH) return false;
    } else if (b === 0x5d && arrayDepth > 0) {
      arrayDepth--;
    } else if (b === 0x3c && i + 1 < scanLen && bytes[i + 1] === 0x3c) {
      dictDepth++;
      i++;
      if (dictDepth > MAX_NESTING_DEPTH) return false;
    } else if (b === 0x3e && i + 1 < scanLen && bytes[i + 1] === 0x3e) {
      if (dictDepth > 0) dictDepth--;
      i++;
    }
  }
  return true;
}

export function validatePdfBytes(bytes, filename = 'dokument.pdf') {
  if (!(bytes instanceof Uint8Array)) {
    throw new Error(`Ungültige Dateidaten für ${filename}.`);
  }
  if (bytes.byteLength < 16) {
    throw new Error(`Die Datei „${filename}“ ist zu klein oder leer.`);
  }
  if (bytes.byteLength > MAX_FILE_BYTES) {
    throw new Error(`Die Datei „${filename}“ überschreitet das Limit von 100 MB.`);
  }
  if (hasExecutableSignature(bytes) || hasForbiddenMarkupPrefix(bytes)) {
    throw new Error(`Die Datei „${filename}“ enthält ein blockiertes Dateiformat (Polyglot/Skript-Schutz).`);
  }
  const offset = findPdfHeaderOffset(bytes);
  if (offset === -1) {
    throw new Error(`Die Datei „${filename}“ hat keinen gültigen PDF-Header (%PDF-).`);
  }
  if (!checkBracketNesting(bytes)) {
    throw new Error(`Die Datei „${filename}“ überschreitet die zulässige Verschachtelungstiefe.`);
  }
  return offset > 0 ? bytes.subarray(offset) : bytes;
}

export function validateImageBytes(bytes, filename = 'bild') {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 8) {
    throw new Error(`Die Bilddatei „${filename}“ ist leer oder ungültig.`);
  }
  if (bytes.byteLength > MAX_FILE_BYTES) {
    throw new Error(`Die Bilddatei „${filename}“ überschreitet das Limit von 100 MB.`);
  }
  if (hasExecutableSignature(bytes) || hasForbiddenMarkupPrefix(bytes)) {
    throw new Error(`Die Datei „${filename}“ wurde aus Sicherheitsgründen blockiert (kein gültiges Rasterbild).`);
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return { format: 'png', bytes };
  }

  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { format: 'jpeg', bytes };
  }

  // WebP: RIFF....WEBP
  if (
    bytes.byteLength >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return { format: 'webp', bytes };
  }

  // GIF87a / GIF89a
  const gifHead = asciiLower(bytes, 0, 6);
  if (gifHead === 'gif87a' || gifHead === 'gif89a') {
    return { format: 'gif', bytes };
  }

  // BMP: BM
  if (bytes[0] === 0x42 && bytes[1] === 0x4d) {
    return { format: 'bmp', bytes };
  }

  throw new Error(`Unbekanntes oder nicht unterstütztes Bildformat in „${filename}“. Erlaubt sind PNG, JPG, WebP, GIF und BMP.`);
}

export function validateTextBytes(bytes, filename = 'text.txt') {
  if (!(bytes instanceof Uint8Array)) {
    throw new Error(`Ungültige Textdatei „${filename}“.`);
  }
  if (bytes.byteLength === 0) {
    throw new Error(`Die Datei „${filename}“ ist leer.`);
  }
  if (bytes.byteLength > MAX_TEXT_BYTES) {
    throw new Error(`Die Textdatei „${filename}“ überschreitet das Limit von 2 MB.`);
  }
  if (hasExecutableSignature(bytes)) {
    throw new Error(`Binärdatei in „${filename}“ abgelehnt.`);
  }
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0x00) {
      throw new Error(`Ungültige NUL-Bytes in „${filename}“.`);
    }
  }
  const decoder = new TextDecoder('utf-8', { fatal: true });
  return decoder.decode(bytes);
}

export function validateBatchFiles(fileList) {
  if (!fileList || fileList.length === 0) {
    throw new Error('Bitte wähle mindestens eine Datei aus.');
  }
  if (fileList.length > MAX_FILES) {
    throw new Error(`Maximal ${MAX_FILES} Dateien pro Vorgang erlaubt.`);
  }
  let total = 0;
  for (const f of fileList) {
    if (f.size > MAX_FILE_BYTES) {
      throw new Error(`Die Datei „${f.name}“ überschreitet 100 MB.`);
    }
    total += f.size;
  }
  if (total > MAX_BATCH_BYTES) {
    throw new Error('Die Gesamtdatenmenge überschreitet 250 MB.');
  }
}
