# Sicherheitsarchitektur – Seelig PDF (`pdf.seelig-designs.eu` & Desktop)

## 1. Grundprinzip: Keine Angriffsfläche durch Zero-Backend
Alle 33 Werkzeuge sowie der vollständige PDF-Reader arbeiten zu **100 % lokal auf dem Gerät**. Es existieren weder Server-Uploads noch eigene API-Endpunkte, Datenbanken, Sessions, Cookies oder Tracking-Skripte.

## 2. Aktive Schutzmechanismen (Web & Desktop)
| Schicht | Schutzmaßnahme | Datei |
|---|---|---|
| **HTTP Security Header (Web)** | `default-src 'none'`, `script-src 'self'`, `worker-src 'self'`, `object-src 'none'`, `base-uri 'none'`, `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `COOP: same-origin`, `CORP: same-origin` | [`public/_headers`](public/_headers) |
| **Desktop-CSP (Tauri)** | Gleiche strikte CSP inkl. `require-trusted-types-for 'script'`, `trusted-types seelig-worker`, `object-src 'none'` und `withGlobalTauri: false` | [`src-tauri/tauri.conf.json`](src-tauri/tauri.conf.json) |
| **Trusted Types** | Erzwungen per `require-trusted-types-for 'script'`; nur benannte Policy `seelig-worker` erlaubt Same-Origin-`.js`/`.mjs`-Worker | [`src/security/trusted-types.js`](src/security/trusted-types.js) |
| **DOM-XSS-Freiheit** | Null `innerHTML`, `outerHTML`, `eval`, `new Function`, `document.write` oder Inline-Event-Handler; alle Knoten — auch die Reader-Textebene und Patchnotes — entstehen über `createElement` / `textContent` | [`src/ui/dom.js`](src/ui/dom.js), [`src/reader/text-layer.js`](src/reader/text-layer.js), [`src/ui/updater-dialog.js`](src/ui/updater-dialog.js) |
| **PDF.js-Härtung** | `isEvalSupported: false`, `enableScripting: false`, `useSystemFonts: false`, Rendering auf `<canvas>` + reine `textContent`-Ebene | [`src/engine/pdf-render.js`](src/engine/pdf-render.js), [`src/reader/pdf-viewport.js`](src/reader/pdf-viewport.js) |
| **Worker-Isolation & DoS-Limits** | Alle `@cantoo/pdf-lib`- & `fflate`-Operationen laufen im isolierten Module-Worker mit 60 s Timeout & `worker.terminate()`; harte Datei-/Seiten-/Pixel-Limits | [`src/workers/pdf.worker.js`](src/workers/pdf.worker.js), [`src/security/limits.js`](src/security/limits.js) |
| **Magic-Byte- & Polyglot-Guard** | Prüft `%PDF-`, PNG/JPG/WebP/GIF/BMP, UTF-8 ohne NUL; blockiert HTML/SVG/XML/MZ/ELF-Polyglots und tiefe Klammer-Verschachtelungen (im Browser und nativ in Rust) | [`src/security/file-guard.js`](src/security/file-guard.js), [`src-tauri/src/lib.rs`](src-tauri/src/lib.rs) |
| **Bild-Sanitization** | Hochgeladene Bilder werden per `createImageBitmap` + sauberem `<canvas>` neu kodiert, wodurch EXIF-Metadaten entfernt werden | [`src/engine/image-ops.js`](src/engine/image-ops.js) |
| **Echte Pixel-Schwärzung** | Geschwärzte Seiten werden gerastert, pixelgenau mit `#000000` überzeichnet und neu aufgebaut – kein kopierbarer Geheimtext bleibt zurück | [`src/engine/ops/security-ops.js`](src/engine/ops/security-ops.js) |
| **Kryptografie** | AES-256 PDF-Verschlüsselung nach ISO 32000-2 sowie `crypto.getRandomValues` mit Rejection-Sampling im Passwort-Generator | [`src/security/sanitize.js`](src/security/sanitize.js) |

## 3. Desktop-Härtung (Tauri v2 Allowlist & Consent-Updater)
- **Keine allgemeinen FS- oder Shell-Capabilities:** [`src-tauri/capabilities/default.json`](src-tauri/capabilities/default.json) enthält **keine** `fs:allow-*`- oder `shell:allow-*`-Berechtigungen.
- **Session-Allowlist statt freier Pfadübergabe:** Das Frontend darf niemals beliebige Dateipfade anfordern. Nur Pfade, die explizit über einen nativen OS-Dateidialog gewählt wurden oder per Windows-Dateiverknüpfung (`.pdf` Doppelklick / Single-Instance) eingingen, landen im Rust-`AppPathState` (`Mutex<HashSet<PathBuf>>`).
- **Atomares Schreiben & Polyglot-Schutz in Rust:** `read_allowed_pdf` erzwingt das 100-MB-Limit, die `.pdf`-Endung, `%PDF-`-Header und blockiert HTML/SVG/MZ-Polyglots bereits im nativen Prozess; `save_pdf_file` prüft `%PDF-` und schreibt atomar über eine temporäre Datei mit anschließender Umbenennung.
- **Externe Links:** Nur `https://` wird über `tauri-plugin-opener` geöffnet.
- **Consent-First & Signierte Updates:** Der Updater fragt niemals ohne Nutzeraktion nach dem Download/Neustart, und produktive Releases in [`src-tauri/tauri.release.conf.json`](src-tauri/tauri.release.conf.json) prüfen Ed25519-Signaturen gegen den fest eincompilierten `pubkey`.

## 4. Bewusst ausgeschlossene Funktionen
- **Webseite zu PDF:** Im Browser wegen CORS nicht möglich, auf einem Server ein klassisches SSRF-Risiko.
- **Alte Binär-Office-Formate (`.doc`, `.xls`, `.ppt`):** Würden serverseitiges LibreOffice/Ghostscript erfordern (große C/C++-Parser-Angriffsfläche).

## 5. Automatisierte „Selbst-Hack“-Prüfung
- `npm test` — Vitest Unit-, Reader- & Adversarial-Tests
- `npm run audit:security` — `npm audit --omit=dev`, Produktions-Lizenzprüfung, Tauri-Capability- & CSP-Prüfung, SAST-Scan & Font-/Subresource-Prüfung auf `src/` und `dist/`
- `npm run test:e2e` — Playwright Red-Team-, Werkzeug- & Reader-Suite gegen das gehärtete Production-Build (`scripts/preview-secure.mjs`)
- `cargo test --manifest-path src-tauri/Cargo.toml` & `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` — Rust-Pfadvalidierung & strenge Lints
