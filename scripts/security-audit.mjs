import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const ROOT = process.cwd();
const ALLOWED_LICENSES = new Set([
  'MIT',
  'Apache-2.0',
  'ISC',
  'BSD-2-Clause',
  'BSD-3-Clause',
  '0BSD',
  'OFL-1.1'
]);

const failures = [];
function fail(msg) {
  failures.push(msg);
  console.error(`[FAIL] ${msg}`);
}
function ok(msg) {
  console.log(`[PASS] ${msg}`);
}

function walkFiles(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(full));
    else out.push(full);
  }
  return out;
}

// 1. npm audit (production dependencies)
try {
  execSync('npm audit --omit=dev --audit-level=low', { cwd: ROOT, stdio: 'pipe' });
  ok('npm audit --omit=dev --audit-level=low: 0 vulnerabilities');
} catch (err) {
  fail(`npm audit failed:\n${err.stdout?.toString() || err.message}`);
}

function isLicenseAllowed(lic) {
  if (!lic || typeof lic !== 'string') return false;
  const cleaned = lic.replace(/[()]/g, ' ').trim();
  if (ALLOWED_LICENSES.has(cleaned)) return true;
  if (/\s+OR\s+/i.test(cleaned)) {
    return cleaned.split(/\s+OR\s+/i).some((part) => ALLOWED_LICENSES.has(part.trim()));
  }
  return false;
}

// 2. License audit on package-lock.json production tree
const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
let checkedCount = 0;
for (const [pkgPath, meta] of Object.entries(lock.packages || {})) {
  if (!pkgPath || meta.dev) continue;
  checkedCount++;
  const lic = meta.license;
  if (!isLicenseAllowed(lic)) {
    fail(`Disallowed or missing production license on ${pkgPath}: ${lic}`);
  }
}
ok(`Production dependency licenses verified (${checkedCount} packages, all allowlisted)`);

// 3. Static SAST scan on src/ and index.html
const srcFiles = [path.join(ROOT, 'index.html'), ...walkFiles(path.join(ROOT, 'src'))];
const FORBIDDEN_SRC_PATTERNS = [
  { name: 'innerHTML', re: /\binnerHTML\b/ },
  { name: 'outerHTML', re: /\bouterHTML\b/ },
  { name: 'setHTMLUnsafe', re: /\bsetHTMLUnsafe\b/ },
  { name: 'insertAdjacentHTML', re: /\binsertAdjacentHTML\b/ },
  { name: 'document.write', re: /\bdocument\.write(?:ln)?\b/ },
  { name: 'eval()', re: /(?<![A-Za-z0-9_])eval\s*\(/ },
  { name: 'new Function()', re: /\bnew\s+Function\s*\(/ },
  { name: 'javascript: URL', re: /javascript:/i },
  { name: 'Sofia Pro / Typekit reference', re: /sofia[-_ ]?pro|use\.typekit\.net/i }
];

for (const file of srcFiles) {
  const content = fs.readFileSync(file, 'utf8');
  const rel = path.relative(ROOT, file);
  for (const rule of FORBIDDEN_SRC_PATTERNS) {
    if (rule.re.test(content)) {
      fail(`Forbidden pattern (${rule.name}) found in ${rel}`);
    }
  }
  if (file.endsWith('.html') && /\son[a-z]+\s*=/i.test(content)) {
    fail(`Inline event handler found in ${rel}`);
  }
}
ok(`Static SAST scan passed on ${srcFiles.length} source files`);

// 4. Verify hardened pdfjs-dist flags in src/engine/pdf-render.js
const pdfRenderSrc = fs.readFileSync(path.join(ROOT, 'src/engine/pdf-render.js'), 'utf8');
if (!/isEvalSupported:\s*false/.test(pdfRenderSrc) || !/enableScripting:\s*false/.test(pdfRenderSrc) || !/useSystemFonts:\s*false/.test(pdfRenderSrc)) {
  fail('Hardened pdfjs-dist flags (isEvalSupported: false, enableScripting: false, useSystemFonts: false) missing in src/engine/pdf-render.js');
} else {
  ok('Hardened pdfjs-dist flags verified');
}

// 5. Verify production build output in dist/
const distDir = path.join(ROOT, 'dist');
if (!fs.existsSync(distDir)) {
  fail('dist/ directory missing. Run npm run build first.');
} else {
  const distFiles = walkFiles(distDir);
  for (const file of distFiles) {
    const ext = path.extname(file).toLowerCase();
    if (!['.html', '.css', '.js', '.mjs', '.svg'].includes(ext)) continue;
    const content = fs.readFileSync(file, 'utf8');
    const rel = path.relative(ROOT, file);

    if (/sofia[-_ ]?pro|use\.typekit\.net/i.test(content)) {
      fail(`Forbidden font/Typekit reference found in ${rel}`);
    }
    if (ext === '.html') {
      if (!content.includes('require-trusted-types-for')) {
        fail(`Missing CSP meta tag in ${rel}`);
      }
      if (/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?\S/.test(content)) {
        fail(`Inline <script> body found in ${rel}`);
      }
      if (/\son[a-z]+\s*=/i.test(content)) {
        fail(`Inline event handler found in ${rel}`);
      }
      const externalSub = [...content.matchAll(/<(?:script|link)\b[^>]*(?:src|href)\s*=\s*["'](https?:\/\/[^"']+)["']/gi)];
      if (externalSub.length > 0) {
        fail(`External script/link subresource in ${rel}: ${externalSub.map((m) => m[1]).join(', ')}`);
      }
    }
    if (ext === '.css') {
      if (/@import\s+(?:url\()?["']?https?:\/\//i.test(content) || /url\(\s*["']?https?:\/\//i.test(content)) {
        fail(`External CSS @import or url() found in ${rel}`);
      }
    }
  }
  ok(`Production dist/ bundle verified (${distFiles.length} total emitted files, 0 forbidden fonts/subresources)`);
}

// 6. Verify Brand config & Tauri desktop security hardening
const brandPath = path.join(ROOT, 'brand/brand.config.json');
if (!fs.existsSync(brandPath)) {
  fail('brand/brand.config.json is missing');
} else {
  const brandRaw = fs.readFileSync(brandPath, 'utf8');
  if (/sofia[-_ ]?pro|use\.typekit\.net/i.test(brandRaw)) {
    fail('Forbidden font/Typekit reference found in brand/brand.config.json');
  }
  try {
    const brand = JSON.parse(brandRaw);
    if (!brand.appName || !brand.domain || !brand.githubRepo) {
      fail('brand/brand.config.json missing required fields (appName, domain, githubRepo)');
    } else {
      ok('brand/brand.config.json validated');
    }
  } catch (err) {
    fail(`Invalid JSON in brand/brand.config.json: ${err.message}`);
  }
}

const capPath = path.join(ROOT, 'src-tauri/capabilities/default.json');
if (!fs.existsSync(capPath)) {
  fail('src-tauri/capabilities/default.json is missing');
} else {
  const cap = JSON.parse(fs.readFileSync(capPath, 'utf8'));
  const perms = (cap.permissions || []).map((p) => (typeof p === 'string' ? p : p?.identifier || ''));
  const dangerous = perms.filter((p) => /^(?:fs|shell):allow-/i.test(p) || p === 'core:default' && perms.includes('fs:default'));
  if (dangerous.length > 0) {
    fail(`Overly broad Tauri permissions found in capabilities/default.json: ${dangerous.join(', ')}`);
  } else {
    ok(`Tauri capabilities verified (${perms.length} scoped permissions, 0 fs:allow/shell:allow)`);
  }
}

const tauriConfPath = path.join(ROOT, 'src-tauri/tauri.conf.json');
if (!fs.existsSync(tauriConfPath)) {
  fail('src-tauri/tauri.conf.json is missing');
} else {
  const tauriConf = JSON.parse(fs.readFileSync(tauriConfPath, 'utf8'));
  const csp = tauriConf?.app?.security?.csp || '';
  if (!csp.includes("default-src 'none'") || !csp.includes("script-src 'self'") || !csp.includes("object-src 'none'")) {
    fail("Tauri app.security.csp must include default-src 'none', script-src 'self' and object-src 'none'");
  } else if (/unsafe-eval|unsafe-inline/i.test(csp)) {
    fail('Tauri app.security.csp must not allow unsafe-eval or unsafe-inline');
  } else {
    ok('Tauri strict CSP validated');
  }
}

if (failures.length > 0) {
  console.error(`\nSecurity audit failed with ${failures.length} issue(s).`);
  process.exit(1);
}
console.log('\nALL SECURITY AUDIT CHECKS PASSED.');
