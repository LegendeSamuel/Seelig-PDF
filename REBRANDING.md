# White-Label & Rebranding Guide

Dieses Projekt ist bewusst so aufgebaut, dass du es in wenigen Minuten auf dein eigenes Branding (Name, Domain, Farben, Logos, Windows-App-Icon) umstellen kannst – per Hand oder mit einem einzigen KI-Prompt.

## Die 5 zentralen Stellen für dein Rebranding

1. **Markendaten (`brand/brand.config.json`):**
   - `appName`, `shortBadge`, `brandName`, `author`, `motto`, `tagline`
   - `domain`, `websiteUrl`, `imprintUrl`, `privacyUrl`
   - `githubRepo`, `githubReleasesUrl`, `updaterEndpoint`
   - `contact` (`email`, `instagramUrl`, `portfolioUrl`)
2. **Farben & Design-Tokens (`src/styles/tokens.css`):**
   - `--bg`, `--surface`, `--surface-card` (Hintergründe)
   - `--amber`, `--gold`, `--yellow`, `--orange`, `--rust`, `--accent`, `--on-accent` (Marken- und Kontrastfarben)
3. **Schrift (`src/styles/fonts.css` & `src/styles/tokens.css`):**
   - Aktuell wird selbst gehostetes `Lexend` (SIL OFL 1.1) über `@fontsource/lexend` lokal gebündelt.
   - Achte bei einem Wechsel darauf, dass deine Schriftlizenz sowohl Web- als auch Desktop-App-Einbettung abdeckt (Open-Source-Alternativen wie `@fontsource/inter`, `@fontsource/plus-jakarta-sans` oder `@fontsource/ibm-plex-sans`).
4. **Logos & Desktop-Icons (`public/assets/brand/` & `brand/icon-concepts/`):**
   - Ersetze `wordmark-white.svg`, `mark-white.svg`, `mark-black.svg` und die SVG-Vorlagen unter `brand/icon-concepts/`.
   - Generiere die Windows-Icons (`.ico` / `.png`) mit:
     ```bash
     node scripts/generate-icons.mjs --concept=a
     ```
5. **Tauri-Desktop-Metadaten (`src-tauri/tauri.conf.json`):**
   - `productName`, `identifier` (umgekehrte Domain, z. B. `de.meinefirma.pdf`), `bundle.windows` und `plugins.updater`.
   - Vergiss nicht `public/CNAME` anzupassen, falls du eine eigene Web-Domain nutzt.

---

## Kopierbarer 1-Prompt für deinen KI-Assistenten

> Passe dieses Repository vollständig auf mein eigenes Branding an. Nutze dazu ausschließlich Open-Source-/lizenziertes Material und brich keine bestehenden Sicherheitsregeln (strikte CSP, Trusted Types, kein `innerHTML`, keine externen CDNs/Fonts):
>
> - Produktname: `[MEIN PRODUKTNAME]` (Kurz-Badge: `[PDF]`)
> - Marke / Firma: `[MEIN MARKENNAME]`
> - Autor / Verantwortlich: `[MEIN NAME]`
> - Motto / Untertitel: `[MEIN MOTTO]`
> - Website / Impressum / Datenschutz: `[https://meine-domain.de]`, `[.../impressum]`, `[.../datenschutz]`
> - GitHub Repo & Releases: `[https://github.com/user/repo]`
> - Kontakt-E-Mail: `[mail@meine-domain.de]`
> - Farben: Primär-Akzent `[#HEX]`, Hover `[#HEX]`, Text auf Akzent `[#HEX]`, Hintergrund `[#HEX]`
> - Desktop-App Identifier: `[de.meinedomain.pdf]`
>
> Aktualisiere `brand/brand.config.json`, `src/styles/tokens.css`, `public/CNAME`, `index.html` (`<title>`), `src-tauri/tauri.conf.json`, `src-tauri/tauri.release.conf.json`, die Icon-SVGs unter `brand/icon-concepts/` sowie `public/assets/brand/` (lasse mich wissen, falls meine SVG-Logodateien noch bereitgestellt werden müssen). Führe anschließend `node scripts/generate-icons.mjs`, `npm test`, `npm run build`, `npm run audit:security`, `npm run test:e2e` und `cargo test --manifest-path src-tauri/Cargo.toml` aus und prüfe die Ergebnisse.
