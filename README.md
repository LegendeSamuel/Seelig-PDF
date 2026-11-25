# Seelig PDF (`pdf.seelig-designs.eu`)

Eine offene, 100 % lokal arbeitende PDF-Suite im Design von **Seelig Designs** — bestehend aus einem vollständigen **PDF-Reader** und **33 PDF-Werkzeugen**, ohne Server-Uploads, ohne Cookies und ohne Tracking. Wahlweise direkt im Browser unter [`pdf.seelig-designs.eu`](https://pdf.seelig-designs.eu) oder als native Windows-Desktop-App über GitHub Releases.

## Warum Seelig PDF (USP)

1. **Zero-Upload & Zero-Telemetrie:** Jede Datei bleibt auf deinem Gerät — egal ob im Browser oder in der Windows-App. Nach dem Laden gehen keine Requests nach außen.
2. **Gehärteter Reader + 33 Werkzeuge an einem Ort:** Mehrere PDFs als Tabs lesen, durchsuchen, im Nacht-/Sepia-Modus oder Split-View vergleichen und mit einem Klick an jedes der 33 Werkzeuge übergeben (z. B. komprimieren, schwärzen, signieren, AES-256 verschlüsseln).
3. **Consent-First Updates:** Die Desktop-App lädt nichts im Hintergrund herunter. Du prüfst aktiv auf Updates, liest die Patchnotes im Dialog und entscheidest selbst über die Installation (Ed25519-signiert).
4. **White-Label-fähig per 1 KI-Prompt:** Über [`brand/brand.config.json`](brand/brand.config.json) und [`REBRANDING.md`](REBRANDING.md) lässt sich die komplette App mit einem Prompt auf eine eigene Marke umstellen.
5. **Nachprüfbare Sicherheit:** Automatisierte SAST-Checks, Trusted Types, `pdfjs-dist`-Härtung (`isEvalSupported: false`, `enableScripting: false`, `useSystemFonts: false`), Rust-Allowlist-IPC und Playwright Red-Team-Tests.

## Web vs. Windows Desktop

| Merkmal | Web (`pdf.seelig-designs.eu`) | Windows Desktop (Tauri v2) |
|---|---|---|
| **Installation** | Keine, direkt im Browser | NSIS-Installer (`Seelig PDF_*_setup.exe`) über GitHub Releases |
| **Standard-PDF-Viewer in Windows** | Im Browser öffnen | Verknüpfung mit `.pdf`-Dateien (Doppelklick im Explorer) |
| **Multi-Tab-Reader & Split-View** | Ja (Tabs + Suche + Thumbnails/Bookmarks) | Ja (Tabs + Explorer-Übergabe per Single-Instance) |
| **33 PDF-Werkzeuge** | Alle 33 lokal im Browser-Worker | Alle 33 + direktes Überschreiben / „Speichern unter“ |
| **Offline-Fähigkeit** | Nach Seitenaufruf lokal | Vollständig offline ab Start |
| **Updates** | Sofort beim Neuladen | Optionaler Update-Check mit Patchnotes & Nutzerfreigabe |

## Reader-Funktionen

- **Multi-Tab-Oberfläche & Single-Instance:** Mehrere Dokumente gleichzeitig öffnen; neue Doppelklicks im Windows-Explorer öffnen automatisch einen neuen Tab im laufenden Fenster.
- **Ansichtsmodi:** Einzelseite, Zweiseiten-Ansicht, Buch-Ansicht (Deckblatt allein) sowie **Split-View** für den parallelen Vergleich zweier Tabs.
- **Lese-Themes & Fokus:** Original, Sepia (warmes Papier) und Nachtmodus (invertiertes Papier bei ruhigem Kontrast) sowie Vollbild-Fokusmodus (`F11`).
- **Suche & Textauswahl:** Dokumentweite Suche (`Ctrl+F`) mit Treffer-Highlighting und sicherer Textauswahl per `textContent` (ohne unsichere HTML-Injektion).
- **Navigation & Komfort:** Einklappbare Seitenleiste mit Thumbnails und echten PDF-Lesezeichen, optionaler lokaler Lesepositions-Speicher (im Browser-Speicher, jederzeit löschbar), Druckfunktion (`Ctrl+P`) und 1-Klick-Übergabe an alle 33 Werkzeuge.

## Alle 33 Werkzeuge

- **Organisieren (9):** PDF zusammenfügen, PDF trennen, Seiten sortieren & kombinieren, Seiten löschen, Seiten extrahieren, Seiten drehen, Seiten pro Blatt (N-Up), Broschüre erstellen, Seiten halbieren / Poster (2×2).
- **Bearbeiten (10):** Wasserzeichen einfügen, Seitenzahlen einfügen, PDFs übereinanderlegen, PDF beschneiden, Seitengröße ändern, PDF unterschreiben, PDF bearbeiten & kommentieren, Formular ausfüllen, Lesezeichen verwalten, PDF-Infos & Metadaten bearbeiten.
- **Konvertieren (7):** Bilder in PDF, PDF in Bilder, Bilder extrahieren, Text & Markdown extrahieren, Text & Markdown zu PDF, Bilder konvertieren & komprimieren, QR-Code generieren.
- **Sicherheit & Optimieren (7):** PDF komprimieren, PDF verschlüsseln (AES-256), Passwortschutz entfernen, PDF sicher schwärzen (echte Pixel-Schwärzung), Metadaten komplett entfernen, PDF glätten/rastern/Graustufen/invertieren, PDFs visuell & textlich vergleichen.

## Windows-SmartScreen (Warum die blaue Meldung erscheinen kann)

Die Open-Source-Windows-Releases von **Seelig PDF** erscheinen bewusst über **GitHub Releases** — ohne kommerzielles EV-Code-Signing-Zertifikat. Deshalb kann Windows Defender SmartScreen bei neuen Releases die blaue Meldung **„Der Computer wurde durch Windows geschützt“** anzeigen, bis genügend Downloads vorliegen.

So prüfst du den Download unabhängig, bevor du auf **„Weitere Informationen“ → „Trotzdem ausführen“** klickst:

1. **Herkunft & Build-Pipeline prüfen:** Der Installer wird öffentlich und nachvollziehbar durch [`.github/workflows/release.yml`](.github/workflows/release.yml) direkt aus diesem Quellcode erstellt — nicht lokal hochgeladen.
2. **SHA-256-Prüfsumme vergleichen (PowerShell):**
   ```powershell
   Get-FileHash .\Seelig-PDF_1.0.0_x64-setup.exe -Algorithm SHA256
   ```
   Vergleiche den ausgegebenen Hash mit der Datei `SHA256SUMS.txt` auf der jeweiligen GitHub-Release-Seite.
3. **Oder vollständig selbst kompilieren:** Alle Quellen liegen offen; mit `npm ci` und `npx tauri build` baust du die `.exe` in unter zwei Minuten selbst auf deinem Rechner.

## White-Label / Eigenes Branding

Du kannst Seelig PDF mit deinem eigenen Namen, eigener Domain, eigenem Logo und eigenen Farben nutzen oder weitergeben. Die vollständige Anleitung und ein fertiger **1-Prompt-Guide für KI-Assistenten** stehen in [`REBRANDING.md`](REBRANDING.md). Die Basiswerte liegen gebündelt in [`brand/brand.config.json`](brand/brand.config.json).

## Entwicklung, Tests & eigener Build

```bash
npm install
npm run dev            # Web-App lokal starten
npm test               # Unit- & Sicherheits-Tests (Vitest)
npm run build          # Production-Build mit CSP-Meta-Tag nach dist/
npm run audit:security # Dependency-Audit, Lizenz-, Tauri-Capability- & SAST-Scan
npm run test:e2e       # Playwright Red-Team-, Tool- & Reader-Tests gegen dist/
npm run verify:all     # Komplette Web- & Sicherheitskette

# Desktop-App (benoetigt Rust & MSVC Build Tools unter Windows)
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
npx tauri dev          # Desktop-App im Dev-Modus
npx tauri build        # Baut NSIS/MSI-Installer fuer Windows
```

### GitHub-Repository & Updater-Key einrichten (Checkliste)

```bash
# 1. Optional: Ed25519-Signierschluessel fuer Consent-Updates erzeugen
npx tauri signer generate -w ~/.tauri/seelig-pdf.key

# 2. GitHub Secrets hinterlegen:
#    TAURI_SIGNING_PUBLIC_KEY  -> Inhalt von ~/.tauri/seelig-pdf.key.pub
#    TAURI_SIGNING_PRIVATE_KEY -> Inhalt von ~/.tauri/seelig-pdf.key

# 3. Repository auf GitHub anlegen und pushen (manuell durchfuehren)
git init
git add .
git commit -m "Release v1.0.0"
gh repo create LegendeSamuel/Seelig-PDF --public --source . --remote origin --push
git tag v1.0.0
git push origin v1.0.0
```

## Deployment der Web-App auf `pdf.seelig-designs.eu`

- **Empfohlen: Cloudflare Pages** (nutzt [`public/_headers`](public/_headers) für `frame-ancestors 'none'`, `X-Frame-Options: DENY` und `HSTS`):
  - Build-Befehl: `npm run build`
  - Ausgabeverzeichnis: `dist`
  - Custom Domain: `pdf.seelig-designs.eu`
- Download-Links auf der Web-Oberfläche verweisen auf die [GitHub Releases](https://github.com/LegendeSamuel/Seelig-PDF/releases), nicht direkt auf ausführbare Dateien.

Weitere Details zur Sicherheitsarchitektur stehen in [`SECURITY.md`](SECURITY.md), alle Lizenzen in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
