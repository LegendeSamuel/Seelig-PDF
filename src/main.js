import './styles/fonts.css';
import './styles/tokens.css';
import './styles/app.css';
import './styles/reader.css';

import { BRAND, applyBrandChrome } from './brand.js';
import { clear, el, svgIcon } from './ui/dom.js';
import { wireDialogHelpers } from './ui/dialogs.js';
import { wireUpdaterDialog } from './ui/updater-dialog.js';
import { wireAppMenubar } from './ui/menubar.js';
import { announcePolite } from './ui/announcer.js';
import { CATEGORIES, TOOLS, getToolById } from './tools/registry.js';
import { getWorkerPolicy } from './security/trusted-types.js';
import { renderPdfPageToCanvas } from './engine/pdf-render.js';
import { createReaderTabStore } from './reader/tab-store.js';
import { createReaderView } from './reader/reader-view.js';
import {
  consumeLaunchFiles,
  isDesktopApp,
  openExternalUrl,
  subscribeExternalFileOpen
} from './platform/bridge.js';

const appRoot = document.getElementById('app-root');
const securityBody = document.getElementById('security-dialog-body');
const previewDialog = document.getElementById('preview-dialog');
const previewTitle = document.getElementById('preview-dialog-title');
const previewBody = document.getElementById('preview-dialog-body');
const navHubLink = document.getElementById('nav-hub-link');
const navReaderLink = document.getElementById('nav-reader-link');
const navUpdatesBtn = document.getElementById('nav-updates-btn');

const readerTabStore = createReaderTabStore();
let activeCategory = 'all';
let searchQuery = '';
const securityDialog = document.getElementById('security-dialog');
const aboutDialog = document.getElementById('about-dialog');
const footerSecurityBtn = document.getElementById('footer-security-btn');

let activeCleanup = null;
let activeReaderView = null;
let pendingChainFiles = [];
let pendingReaderFiles = [];
let appMenubar = { syncState: () => {} };

function syncAppMenubarState() {
  if (activeReaderView) {
    appMenubar.syncState(activeReaderView.getMenuState());
  } else {
    appMenubar.syncState({
      hasActivePdf: false,
      isReaderRoute: false,
      viewMode: 'single',
      readingMode: 'original',
      sidebarOpen: true,
      splitActive: false,
      fullscreen: false
    });
  }
}

function syncNavCurrent(routeKind) {
  if (navHubLink) navHubLink.setAttribute('aria-current', routeKind === 'hub' ? 'page' : 'false');
  if (navReaderLink) navReaderLink.setAttribute('aria-current', routeKind === 'reader' ? 'page' : 'false');
  if (appRoot) appRoot.classList.toggle('is-reader-root', routeKind === 'reader');
  if (routeKind !== 'reader') {
    document.documentElement.classList.remove('is-fullscreen-reading');
  }
}

function populateSecurityDialog() {
  clear(securityBody);
  const items = [
    ['100 % Lokale Verarbeitung', `Alle Reader- und PDF-Operationen laufen lokal auf deinem Gerät (${BRAND.appName}). Es gibt kein Backend, keine Server-Uploads, keine Cookies und kein Tracking.`],
    ['Content Security Policy & Trusted Types', 'Strikte CSP (script-src \'self\', object-src \'none\', base-uri \'none\', frame-ancestors \'none\') plus Trusted-Types-Policy „seelig-worker“ blockieren jeglichen eingeschleusten Code.'],
    ['Gehärteter PDF.js-Renderer', 'Rendering ausschließlich auf Pixel-Canvas mit deaktiviertem PDF-Scripting (isEvalSupported: false, enableScripting: false, useSystemFonts: false) und sicherer Textauswahl über textContent.'],
    ['Isolierter Web Worker & DoS-Schutz', 'Alle PDF-Strukturänderungen laufen im isolierten Worker mit 60-Sekunden-Zeitlimit, Magic-Byte-Prüfung gegen Polyglots sowie Datei-, Seiten- und Pixel-Limits.'],
    ['Tauri Desktop-Sicherheit', 'In der Windows-App greift Rust ausschließlich über eine Pfad-Allowlist (Doppelklick-Startargument oder nativer Datei-Dialog) auf PDFs zu – kein offenes Dateisystem, keine Shell-Ausführung.'],
    ['Echte Pixel-Schwärzung', 'Geschwärzte Seiten werden neu gerastert und mit Schwarz überschrieben – unter schwarzen Balken bleibt kein lesbarer Text zurück.'],
    ['Auditierte Open-Source-Bibliotheken', 'Ausschließlich minimale, lizenzgeprüfte Kernpakete: @cantoo/pdf-lib (MIT), pdfjs-dist (Apache-2.0), fflate (MIT), uqr (MIT) sowie Lexend (SIL OFL 1.1).']
  ];

  const list = el('div', { className: 'form-stack' });
  for (const [title, text] of items) {
    list.appendChild(
      el(
        'div',
        { className: 'legal-note' },
        el('strong', {}, title),
        el('p', { className: 'muted-copy' }, text)
      )
    );
  }
  securityBody.appendChild(list);
}

async function openPagePreview(pdfDoc, pageNumber) {
  if (!pdfDoc || !previewDialog) return;
  clear(previewBody);
  previewTitle.textContent = `Seitenvorschau – Seite ${pageNumber}`;
  const canvas = el('canvas', { style: 'max-width:100%;height:auto;border-radius:8px;background:#fff;' });
  previewBody.appendChild(canvas);
  previewDialog.showModal();
  await renderPdfPageToCanvas(pdfDoc, pageNumber, canvas, { scale: 1.6 });
}

function renderHub() {
  if (activeCleanup) {
    activeCleanup();
    activeCleanup = null;
  }
  activeReaderView = null;
  clear(appRoot);
  syncNavCurrent('hub');
  document.title = `${BRAND.appName} – Reader & Werkzeuge`;

  const desktopBanner = !isDesktopApp()
    ? el(
        'div',
        { className: 'legal-note', style: 'display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:1rem;margin-bottom:1.5rem;' },
        el(
          'div',
          { className: 'form-stack', style: 'gap:0.25rem;' },
          el('strong', {}, `${BRAND.appName} als Windows-Standard-PDF-Viewer`),
          el('p', { className: 'muted-copy' }, 'Öffne PDFs per Doppelklick im Explorer mit Tabs, Split-View, Nachtmodus und allen 33 Werkzeugen offline. Quellcode, SHA-256-Prüfsummen und White-Label-Anleitung liegen transparent auf GitHub.')
        ),
        el(
          'div',
          { className: 'result-actions' },
          el('a', { href: '#/reader', className: 'cta-button' }, 'Browser-Reader öffnen'),
          el(
            'a',
            {
              href: BRAND.githubReleasesUrl,
              className: 'cta-button cta-button--filled',
              target: '_blank',
              rel: 'noopener noreferrer'
            },
            'GitHub Releases'
          )
        )
      )
    : null;

  const hero = el(
    'section',
    { className: 'hub-hero' },
    el('span', { className: 'eyebrow' }, `${BRAND.brandName} · PDF-Werkstatt`),
    el(
      'div',
      { className: 'hub-hero-row' },
      el(
        'div',
        { className: 'form-stack' },
        el('h1', { id: 'main-content', tabindex: '-1' }, 'Alle Werkzeuge für deine PDFs.'),
        el('p', { className: 'lead' }, `${BRAND.motto} ${BRAND.tagline}`)
      ),
      el(
        'div',
        { className: 'trust-pill' },
        svgIcon('shield', 18),
        el('span', {}, '100 % lokal · 0 Bytes Server-Upload')
      )
    )
  );

  const searchInput = el('input', {
    type: 'search',
    id: 'tool-search',
    className: 'search-input',
    value: searchQuery,
    placeholder: 'Werkzeug suchen (z. B. komprimieren, schwärzen, QR, drehen) …',
    autocorrect: 'off',
    autocapitalize: 'none',
    spellcheck: 'false'
  });

  const countLabel = el('span', { className: 'search-count' });
  const filterRow = el('div', { className: 'gallery-filters', role: 'group', 'aria-label': 'Kategorien filtern' });
  const gridHost = el('div', { className: 'form-stack' });

  function renderGrid() {
    clear(gridHost);
    const q = searchQuery.trim().toLowerCase();
    const filtered = TOOLS.filter((t) => {
      const catOk = activeCategory === 'all' || t.category === activeCategory;
      if (!catOk) return false;
      if (!q) return true;
      return (
        t.name.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        t.categoryLabel.toLowerCase().includes(q)
      );
    });

    countLabel.textContent = `${filtered.length} von ${TOOLS.length} Werkzeugen`;

    if (filtered.length === 0) {
      gridHost.appendChild(
        el('p', { className: 'muted-copy' }, 'Kein passendes Werkzeug gefunden. Probiere einen anderen Suchbegriff.')
      );
      return;
    }

    const catsToShow = activeCategory === 'all'
      ? CATEGORIES.filter((c) => c.id !== 'all')
      : CATEGORIES.filter((c) => c.id === activeCategory);

    for (const cat of catsToShow) {
      const catTools = filtered.filter((t) => t.category === cat.id);
      if (!catTools.length) continue;

      const cards = catTools.map((t) =>
        el(
          'a',
          {
            href: `#/tool/${t.id}`,
            className: 'tool-card',
            dataset: { toolId: t.id }
          },
          el(
            'div',
            { className: 'tool-card-top' },
            el('span', { className: 'tool-icon' }, svgIcon(t.icon, 20)),
            el('span', { className: 'tool-tag' }, t.categoryLabel)
          ),
          el('h3', {}, t.name),
          el('p', {}, t.description)
        )
      );

      gridHost.appendChild(
        el(
          'section',
          { className: 'category-section', 'aria-labelledby': `cat-${cat.id}` },
          el(
            'div',
            { className: 'category-header' },
            el('h2', { id: `cat-${cat.id}`, className: 'category-title' }, cat.label),
            el('span', { className: 'caption-copy' }, `${catTools.length} Werkzeuge`)
          ),
          el('div', { className: 'tools-grid' }, cards)
        )
      );
    }
  }

  for (const cat of CATEGORIES) {
    const btn = el(
      'button',
      {
        type: 'button',
        className: 'filter-btn',
        'aria-pressed': String(cat.id === activeCategory),
        onClick: () => {
          activeCategory = cat.id;
          filterRow.querySelectorAll('.filter-btn').forEach((b, idx) => {
            b.setAttribute('aria-pressed', String(CATEGORIES[idx].id === activeCategory));
          });
          renderGrid();
        }
      },
      cat.label
    );
    filterRow.appendChild(btn);
  }

  searchInput.addEventListener('input', () => {
    searchQuery = searchInput.value;
    renderGrid();
  });

  const controls = el(
    'div',
    { className: 'hub-controls' },
    el(
      'search',
      {},
      el(
        'div',
        { className: 'search-row' },
        el(
          'div',
          { className: 'search-field-wrap' },
          svgIcon('search', 18),
          el('label', { htmlFor: 'tool-search', className: 'visually-hidden' }, 'Werkzeug suchen'),
          searchInput
        ),
        countLabel
      )
    ),
    filterRow
  );

  renderGrid();
  appRoot.append(hero, desktopBanner, controls, gridHost);
  syncAppMenubarState();
}

async function renderReaderView() {
  if (activeCleanup) {
    activeCleanup();
    activeCleanup = null;
  }
  clear(appRoot);
  syncNavCurrent('reader');
  document.title = `PDF-Reader | ${BRAND.appName}`;

  const view = createReaderView({
    tabStore: readerTabStore,
    onGoTools: () => {
      window.location.hash = '#/';
    },
    onSendToTool: (toolId, fileObj) => {
      pendingChainFiles = fileObj ? [fileObj] : [];
      window.location.hash = `#/tool/${toolId}`;
    },
    onStateChange: (state) => {
      appMenubar.syncState(state);
    }
  });

  activeCleanup = view.cleanup;
  activeReaderView = view;
  appRoot.appendChild(view.element);
  syncAppMenubarState();

  if (pendingReaderFiles.length > 0) {
    const batch = [...pendingReaderFiles];
    pendingReaderFiles = [];
    for (const f of batch) {
      await view.openPdfInReader(f);
    }
  }

  const h1 = document.getElementById('reader-heading');
  if (h1) h1.focus();
}

function renderToolView(tool) {
  if (activeCleanup) {
    activeCleanup();
    activeCleanup = null;
  }
  activeReaderView = null;
  clear(appRoot);
  syncNavCurrent('tool');
  document.title = `${tool.name} | ${BRAND.appName}`;

  const initialFiles = [...pendingChainFiles];
  pendingChainFiles = [];

  const instance = tool.mount(tool, {
    initialFiles,
    goHome: () => {
      window.location.hash = '#/';
    },
    chainToTool: (nextToolId, fileObj) => {
      pendingChainFiles = [fileObj];
      window.location.hash = `#/tool/${nextToolId}`;
    },
    openPagePreview
  });

  activeCleanup = instance.cleanup;
  appRoot.appendChild(instance.element);
  syncAppMenubarState();
  const h1 = document.getElementById('tool-heading');
  if (h1) h1.focus();
  announcePolite(`${tool.name} geöffnet.`);
}

function route() {
  const hash = window.location.hash || '#/';
  if (hash === '#/reader') {
    renderReaderView();
    return;
  }
  const match = /^#\/tool\/([a-z0-9-]+)$/i.exec(hash);
  if (match) {
    const tool = getToolById(match[1]);
    if (tool) {
      renderToolView(tool);
      return;
    }
  }
  renderHub();
}

async function init() {
  getWorkerPolicy();
  applyBrandChrome();
  wireDialogHelpers();
  populateSecurityDialog();
  const updater = wireUpdaterDialog();

  if (footerSecurityBtn && aboutDialog) {
    footerSecurityBtn.addEventListener('click', () => {
      if (aboutDialog.open) aboutDialog.close();
    });
  }

  appMenubar = wireAppMenubar({
    onAction: (action) => {
      if (action === 'go-hub') {
        window.location.hash = '#/';
        return;
      }
      if (action === 'open-security') {
        if (aboutDialog?.open) aboutDialog.close();
        if (securityDialog && !securityDialog.open) securityDialog.showModal();
        return;
      }
      if (action === 'open-updates') {
        updater?.openDialog();
        return;
      }
      if (action === 'open-about') {
        if (aboutDialog && !aboutDialog.open) aboutDialog.showModal();
        return;
      }
      if (action === 'file-open') {
        if (activeReaderView) {
          activeReaderView.openFilePicker();
        } else {
          window.location.hash = '#/reader';
          requestAnimationFrame(() => activeReaderView?.openFilePicker());
        }
        return;
      }
      if (action === 'view-fullscreen') {
        if (activeReaderView) {
          activeReaderView.toggleFullscreen();
        } else {
          window.location.hash = '#/reader';
          requestAnimationFrame(() => activeReaderView?.toggleFullscreen());
        }
        return;
      }
      if (!activeReaderView) return;
      if (action === 'file-save') activeReaderView.handleSave(false);
      else if (action === 'file-save-as') activeReaderView.handleSave(true);
      else if (action === 'file-print') activeReaderView.handlePrint();
      else if (action === 'file-close-tab') activeReaderView.closeActiveTab();
      else if (action === 'view-sidebar') activeReaderView.toggleSidebar();
      else if (action === 'view-split') activeReaderView.cycleSplitMode();
      else if (action === 'view-search') activeReaderView.toggleSearchBar(true);
      else if (action === 'view-rotate') activeReaderView.rotateView();
      else if (action.startsWith('view-mode-')) activeReaderView.setViewMode(action.replace('view-mode-', ''));
      else if (action.startsWith('reading-mode-')) activeReaderView.setReadingMode(action.replace('reading-mode-', ''));
    },
    onToolSelect: (toolId) => {
      if (activeReaderView) {
        activeReaderView.handoffActiveToTool(toolId);
      } else {
        pendingChainFiles = [];
        window.location.hash = `#/tool/${toolId}`;
      }
    }
  });

  if (isDesktopApp() && navUpdatesBtn && updater) {
    navUpdatesBtn.hidden = false;
    navUpdatesBtn.addEventListener('click', () => updater.openDialog());
  }

  // Open PDF results directly in Reader from any tool result panel
  window.addEventListener('seelig:open-in-reader', (e) => {
    const detail = e.detail;
    if (detail?.bytes) {
      pendingReaderFiles.push(detail);
      window.location.hash = '#/reader';
    }
  });

  // In Desktop mode, open external target="_blank" links via OS browser
  if (isDesktopApp()) {
    document.addEventListener('click', (e) => {
      const a = e.target.closest('a[target="_blank"]');
      if (a && a.href && /^https?:|^mailto:/i.test(a.href)) {
        e.preventDefault();
        openExternalUrl(a.href).catch(() => {});
      }
    });
  }

  window.addEventListener('hashchange', route);

  // Desktop launch arguments & Single-Instance explorer double-click handling
  if (isDesktopApp()) {
    const launchFiles = await consumeLaunchFiles().catch(() => []);
    if (launchFiles.length > 0) {
      pendingReaderFiles.push(...launchFiles);
      window.location.hash = '#/reader';
    }
    await subscribeExternalFileOpen(async (files) => {
      if (window.location.hash === '#/reader' && activeReaderView) {
        for (const f of files) {
          await activeReaderView.openPdfInReader(f);
        }
      } else {
        pendingReaderFiles.push(...files);
        window.location.hash = '#/reader';
      }
    }).catch(() => {});
    if (updater) updater.maybeAutoCheckOnStart();
  }

  route();
}

init();
