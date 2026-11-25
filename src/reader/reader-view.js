import { clear, el, svgIcon } from '../ui/dom.js';
import { createDropzone } from '../ui/dropzone.js';
import { destroyPdfDoc, openHardenedPdfDocument, renderPdfPageToCanvas } from '../engine/pdf-render.js';
import { announceAlert, announcePolite } from '../ui/announcer.js';
import { sanitizeDisplayText } from '../security/sanitize.js';
import {
  isDesktopApp,
  openPdfFilesFromDesktopDialog,
  savePdfFile
} from '../platform/bridge.js';
import {
  clearSavedReadingPositions,
  computeDocHash,
  getSavedReadingPage,
  loadReaderPrefs,
  saveReaderPrefs,
  setSavedReadingPage
} from './tab-store.js';
import { createPdfViewport } from './pdf-viewport.js';
import { searchPdfDocument } from './search.js';

function wireRovingFocusFallback(container, getItems, orientation = 'horizontal') {
  if (typeof HTMLElement === 'undefined' || 'focusGroup' in HTMLElement.prototype) return;

  function syncTabStops(activeEl = null) {
    const items = getItems();
    if (!items.length) return;
    const chosen = activeEl && items.includes(activeEl) ? activeEl : items[0];
    items.forEach((item) => {
      item.tabIndex = item === chosen ? 0 : -1;
    });
  }

  container.addEventListener('focusin', ({ target }) => {
    const items = getItems();
    if (items.includes(target)) syncTabStops(target);
  });

  container.addEventListener('keydown', (e) => {
    const items = getItems();
    if (!items.length) return;
    const idx = items.indexOf(document.activeElement);
    if (idx === -1) return;

    const rtl = getComputedStyle(container).direction === 'rtl';
    const nextKey = orientation === 'vertical' ? 'ArrowDown' : rtl ? 'ArrowLeft' : 'ArrowRight';
    const prevKey = orientation === 'vertical' ? 'ArrowUp' : rtl ? 'ArrowRight' : 'ArrowLeft';

    let nextIdx = null;
    if (e.key === nextKey) nextIdx = (idx + 1) % items.length;
    else if (e.key === prevKey) nextIdx = (idx - 1 + items.length) % items.length;
    else if (e.key === 'Home') nextIdx = 0;
    else if (e.key === 'End') nextIdx = items.length - 1;

    if (nextIdx !== null) {
      e.preventDefault();
      syncTabStops(items[nextIdx]);
      items[nextIdx].focus();
    }
  });

  return syncTabStops;
}

export function createReaderView({
  tabStore,
  onGoTools,
  onSendToTool,
  onStateChange = () => {}
}) {
  const root = el('section', { className: 'reader-shell', 'aria-labelledby': 'reader-heading' });
  const heading = el('h1', { id: 'reader-heading', className: 'visually-hidden', tabindex: '-1' }, 'Seelig PDF Reader');
  const prefs = loadReaderPrefs();

  const pdfDocsCache = new Map(); // tabId -> pdfjsDoc
  let currentSearchQuery = '';
  let currentMatches = [];
  let currentMatchIdx = -1;
  let searchOpen = false;
  let fullscreenMode = false;

  function getMenuState() {
    const hasActivePdf = Boolean(tabStore.getActiveTab());
    return {
      hasActivePdf,
      isReaderRoute: true,
      viewMode: prefs.viewMode,
      readingMode: prefs.readingMode,
      sidebarOpen: prefs.sidebarOpen,
      splitActive: tabStore.state.splitMode !== 'off' && hasActivePdf,
      fullscreen: fullscreenMode
    };
  }

  function notifyState() {
    onStateChange(getMenuState());
  }

  const primaryViewport = createPdfViewport({
    onCurrentPageChange: (pageNum) => {
      const tab = tabStore.getActiveTab();
      if (!tab) return;
      tab.currentPage = pageNum;
      pageNumInput.value = String(pageNum);
      if (prefs.rememberPosition && tab.docHash) {
        setSavedReadingPage(tab.docHash, pageNum);
      }
      updateSidebarActiveThumb(pageNum);
    },
    onError: (msg) => announceAlert(msg)
  });

  const secondaryViewport = createPdfViewport({
    onError: (msg) => announceAlert(msg)
  });

  // 1. Tab Bar
  const tabList = el('div', {
    className: 'reader-tablist',
    role: 'tablist',
    focusgroup: 'tablist nomemory',
    'aria-label': 'Geöffnete PDF-Dokumente'
  });
  const syncTabListFallback = wireRovingFocusFallback(tabList, () =>
    Array.from(tabList.querySelectorAll('[role="tab"]'))
  );

  const addTabBtn = el(
    'button',
    {
      type: 'button',
      className: 'tb-btn',
      title: 'Weitere PDF öffnen (Strg+O)',
      'aria-label': 'Weitere PDF öffnen',
      onClick: () => openFilePicker()
    },
    '+ Öffnen'
  );

  const tabBarRow = el('div', { className: 'reader-tabbar-row' }, tabList, addTabBtn);

  // 2. Toolbar
  const pageNumInput = el('input', {
    type: 'number',
    className: 'tb-page-input',
    min: 1,
    value: '1',
    'aria-label': 'Aktuelle Seite'
  });
  const pageTotalSpan = el('span', { className: 'caption-copy' }, '/ 0');
  const zoomLabelSpan = el('span', { className: 'caption-copy' }, 'Breite');

  const btnSidebar = el('button', {
    type: 'button',
    className: 'tb-btn',
    'aria-pressed': String(prefs.sidebarOpen),
    title: 'Seitenleiste ein-/ausblenden',
    onClick: () => toggleSidebar()
  }, 'Seitenleiste');

  const btnSplit = el('button', {
    type: 'button',
    className: 'tb-btn',
    'aria-pressed': 'false',
    title: 'Geteilte Ansicht (Split-View)',
    onClick: () => cycleSplitMode()
  }, 'Split-View');

  const btnSearchToggle = el('button', {
    type: 'button',
    className: 'tb-btn',
    'aria-pressed': 'false',
    title: 'Im Dokument suchen (Strg+F)',
    onClick: () => toggleSearchBar()
  }, svgIcon('search', 16), 'Suche');

  const btnFullscreenMode = el('button', {
    type: 'button',
    className: 'tb-btn',
    'aria-pressed': 'false',
    title: 'Vollansicht (F11)',
    onClick: () => setFullscreenReading(!fullscreenMode, { requestNative: true })
  }, 'Vollansicht');

  const fullscreenExitBtn = el(
    'button',
    {
      type: 'button',
      className: 'fullscreen-exit-pill',
      hidden: true,
      onClick: () => setFullscreenReading(false, { requestNative: true })
    },
    'Vollansicht beenden (Esc)'
  );

  const viewModeSelect = el(
    'select',
    {
      className: 'tb-select',
      'aria-label': 'Seitenlayout wählen',
      onChange: () => setViewMode(viewModeSelect.value)
    },
    el('option', { value: 'single', selected: prefs.viewMode === 'single' }, 'Einzelseite'),
    el('option', { value: 'two-page', selected: prefs.viewMode === 'two-page' }, 'Zwei Seiten'),
    el('option', { value: 'book', selected: prefs.viewMode === 'book' }, 'Buchansicht')
  );

  const readingModeSelect = el(
    'select',
    {
      className: 'tb-select',
      'aria-label': 'Lesemodus wählen',
      onChange: () => setReadingMode(readingModeSelect.value)
    },
    el('option', { value: 'original', selected: prefs.readingMode === 'original' }, 'Original'),
    el('option', { value: 'sepia', selected: prefs.readingMode === 'sepia' }, 'Warm / Sepia'),
    el('option', { value: 'night', selected: prefs.readingMode === 'night' }, 'Nachtmodus')
  );

  const handoffSelect = el(
    'select',
    {
      className: 'tb-select',
      'aria-label': 'Geöffnete PDF in Werkzeug bearbeiten',
      onChange: () => {
        const toolId = handoffSelect.value;
        handoffSelect.value = '';
        if (!toolId) return;
        const tab = tabStore.getActiveTab();
        if (!tab) return;
        onSendToTool(toolId, { name: tab.name, bytes: tab.bytes, filePath: tab.filePath });
      }
    },
    el('option', { value: '' }, 'Bearbeiten mit …'),
    el('option', { value: 'compress' }, 'PDF komprimieren'),
    el('option', { value: 'redact' }, 'PDF sicher schwärzen'),
    el('option', { value: 'sign' }, 'PDF unterschreiben'),
    el('option', { value: 'annotate' }, 'PDF kommentieren'),
    el('option', { value: 'fill-form' }, 'Formular ausfüllen'),
    el('option', { value: 'watermark' }, 'Wasserzeichen einfügen'),
    el('option', { value: 'page-numbers' }, 'Seitenzahlen einfügen'),
    el('option', { value: 'protect' }, 'PDF verschlüsseln'),
    el('option', { value: 'strip-metadata' }, 'Metadaten entfernen'),
    el('option', { value: 'split' }, 'PDF trennen'),
    el('option', { value: 'organize' }, 'Seiten sortieren'),
    el('option', { value: 'rotate' }, 'Seiten drehen'),
    el('option', { value: 'extract-text' }, 'Text extrahieren'),
    el('option', { value: 'merge' }, 'Mit weiterer PDF zusammenfügen')
  );

  const toolbar = el(
    'div',
    {
      className: 'reader-toolbar',
      role: 'toolbar',
      focusgroup: 'toolbar wrap',
      'aria-label': 'PDF-Reader-Werkzeugleiste'
    },
    el(
      'div',
      { className: 'reader-tool-group', role: 'group', 'aria-label': 'Seitenleiste' },
      btnSidebar
    ),
    el('span', { className: 'reader-separator', role: 'separator', 'aria-orientation': 'vertical' }),
    el(
      'div',
      { className: 'reader-tool-group', role: 'group', 'aria-label': 'Navigation und Zoom' },
      el('button', {
        type: 'button',
        className: 'tb-btn',
        title: 'Vorherige Seite',
        'aria-label': 'Vorherige Seite',
        onClick: () => jumpPageDelta(-1)
      }, '‹'),
      pageNumInput,
      pageTotalSpan,
      el('button', {
        type: 'button',
        className: 'tb-btn',
        title: 'Nächste Seite',
        'aria-label': 'Nächste Seite',
        onClick: () => jumpPageDelta(1)
      }, '›'),
      el('button', {
        type: 'button',
        className: 'tb-btn',
        title: 'Verkleinern',
        'aria-label': 'Verkleinern',
        onClick: () => adjustZoom(-0.15)
      }, '−'),
      zoomLabelSpan,
      el('button', {
        type: 'button',
        className: 'tb-btn',
        title: 'Vergrößern',
        'aria-label': 'Vergrößern',
        onClick: () => adjustZoom(0.15)
      }, '+'),
      el('button', {
        type: 'button',
        className: 'tb-btn',
        title: 'An Seitenbreite anpassen',
        onClick: () => setFitMode('fit-width')
      }, 'Breite'),
      el('button', {
        type: 'button',
        className: 'tb-btn',
        title: 'Ganze Seite einpassen',
        onClick: () => setFitMode('fit-page')
      }, 'Seite'),
      el('button', {
        type: 'button',
        className: 'tb-btn',
        title: 'Ansicht um 90° drehen (R)',
        'aria-label': 'Ansicht drehen',
        onClick: () => rotateView()
      }, '↻')
    ),
    el('span', { className: 'reader-separator', role: 'separator', 'aria-orientation': 'vertical' }),
    el(
      'div',
      { className: 'reader-tool-group', role: 'group', 'aria-label': 'Ansicht und Suche' },
      viewModeSelect,
      readingModeSelect,
      btnSplit,
      btnSearchToggle,
      btnFullscreenMode
    ),
    el('span', { className: 'reader-separator', role: 'separator', 'aria-orientation': 'vertical' }),
    el(
      'div',
      { className: 'reader-tool-group', role: 'group', 'aria-label': 'Werkzeuge' },
      handoffSelect
    )
  );
  wireRovingFocusFallback(toolbar, () => Array.from(toolbar.querySelectorAll('button, select, input')));

  // 3. Search Bar
  const searchInput = el('input', {
    type: 'search',
    id: 'reader-search-input',
    placeholder: 'Im Dokument suchen …'
  });
  const searchStatus = el('span', { className: 'caption-copy' }, '0 / 0');
  const searchBar = el(
    'div',
    { className: 'reader-search-bar', hidden: true },
    el('label', { htmlFor: 'reader-search-input', className: 'visually-hidden' }, 'Im Dokument suchen'),
    searchInput,
    searchStatus,
    el('button', { type: 'button', className: 'tb-btn', 'aria-label': 'Vorheriger Treffer', onClick: () => stepSearch(-1) }, '‹'),
    el('button', { type: 'button', className: 'tb-btn', 'aria-label': 'Nächster Treffer', onClick: () => stepSearch(1) }, '›'),
    el('button', { type: 'button', className: 'tb-btn', 'aria-label': 'Suche schließen', onClick: () => toggleSearchBar(false) }, '×')
  );

  // 4. Sidebar (Thumbnails & Bookmarks + Reading-Pos Toggle)
  const sidebarThumbsBtn = el('button', {
    type: 'button',
    className: 'reader-sidebar-tab',
    role: 'tab',
    'aria-selected': String(prefs.sidebarTab !== 'bookmarks'),
    onClick: () => switchSidebarTab('thumbs')
  }, 'Seiten');
  const sidebarBookmarksBtn = el('button', {
    type: 'button',
    className: 'reader-sidebar-tab',
    role: 'tab',
    'aria-selected': String(prefs.sidebarTab === 'bookmarks'),
    onClick: () => switchSidebarTab('bookmarks')
  }, 'Lesezeichen');
  const sidebarScroll = el('div', { className: 'reader-sidebar-scroll' });

  const rememberCheck = el('input', {
    type: 'checkbox',
    id: 'reader-remember-pos',
    checked: Boolean(prefs.rememberPosition),
    onChange: () => {
      prefs.rememberPosition = rememberCheck.checked;
      saveReaderPrefs({ rememberPosition: prefs.rememberPosition });
      if (!prefs.rememberPosition) clearSavedReadingPositions();
    }
  });
  const sidebarFooter = el(
    'div',
    { className: 'form-stack', style: 'padding:0.55rem 0.75rem;border-top:1px solid var(--line-subtle);font-size:0.8rem;' },
    el('label', { htmlFor: 'reader-remember-pos', className: 'choice-row' }, rememberCheck, 'Leseposition lokal merken')
  );

  const sidebar = el(
    'aside',
    { className: 'reader-sidebar', 'aria-label': 'Dokument-Navigation' },
    el('div', { className: 'reader-sidebar-tabs', role: 'tablist', 'aria-label': 'Seitenleisten-Ansicht' }, sidebarThumbsBtn, sidebarBookmarksBtn),
    sidebarScroll,
    sidebarFooter
  );

  // 5. Primary + Split Panes & Empty Dropzone
  const splitTargetSelect = el('select', {
    className: 'tb-select',
    'aria-label': 'Zweites Dokument für Split-View wählen',
    onChange: () => {
      tabStore.setSplitSecondTab(splitTargetSelect.value);
      renderSecondaryPane();
    }
  });
  const primaryPane = el('div', { className: 'reader-pane' }, primaryViewport.element);
  const secondaryPane = el(
    'div',
    { className: 'reader-pane', hidden: true },
    el('div', { className: 'reader-pane-header' }, el('span', {}, 'Zweite Ansicht'), splitTargetSelect),
    secondaryViewport.element
  );

  const emptyDropzone = createDropzone({
    id: 'reader-open-input',
    multiple: true,
    label: 'PDF-Dateien zum Lesen auswählen oder hier ablegen',
    hint: 'Mehrere Tabs · Volltextsuche · Nachtmodus · Split-View · 100 % lokal',
    onFilesChange: async (files) => {
      if (!files.length) return;
      for (const f of files) {
        await openPdfInReader(f);
      }
      emptyDropzone.setFiles([]);
    }
  });

  const emptyState = el(
    'div',
    { className: 'reader-empty-state' },
    el('h2', {}, 'Bereit zum Lesen'),
    el('p', { className: 'muted-copy' }, 'Öffne eine oder mehrere PDF-Dateien direkt im sicheren Browser-Reader.'),
    emptyDropzone.element,
    isDesktopApp()
      ? el(
          'button',
          {
            type: 'button',
            className: 'cta-button',
            onClick: () => openFilePicker()
          },
          'Aus Windows-Explorer wählen'
        )
      : null
  );

  const bodyGrid = el('div', { className: 'reader-body' }, sidebar, primaryPane, secondaryPane);

  // Hidden file input for Web "+ Öffnen"
  const hiddenWebInput = el('input', {
    type: 'file',
    accept: '.pdf,application/pdf',
    multiple: true,
    className: 'visually-hidden',
    onChange: async () => {
      if (!hiddenWebInput.files?.length) return;
      const { validatePdfBytes } = await import('../security/file-guard.js');
      for (const file of hiddenWebInput.files) {
        try {
          const cleanName = sanitizeDisplayText(file.name, 90) || 'dokument.pdf';
          const bytes = validatePdfBytes(new Uint8Array(await file.arrayBuffer()), cleanName);
          await openPdfInReader({ name: cleanName, bytes });
        } catch (err) {
          announceAlert(err.message);
        }
      }
      hiddenWebInput.value = '';
    }
  });

  root.append(heading, tabBarRow, toolbar, searchBar, emptyState, bodyGrid, fullscreenExitBtn, hiddenWebInput);

  async function openFilePicker() {
    if (isDesktopApp()) {
      try {
        const picked = await openPdfFilesFromDesktopDialog();
        for (const f of picked) await openPdfInReader(f);
      } catch (err) {
        announceAlert(err.message);
      }
    } else {
      hiddenWebInput.click();
    }
  }

  async function ensurePdfDocForTab(tab) {
    if (pdfDocsCache.has(tab.id)) return pdfDocsCache.get(tab.id);
    const doc = await openHardenedPdfDocument(tab.bytes);
    pdfDocsCache.set(tab.id, doc);
    tab.pageCount = doc.numPages;
    return doc;
  }

  async function openPdfInReader({ name, bytes, filePath = null }) {
    const docHash = await computeDocHash(bytes);
    const savedPage = prefs.rememberPosition ? getSavedReadingPage(docHash) : 1;
    const tab = tabStore.openTab({ name, bytes, filePath, docHash, initialPage: savedPage });
    await activateCurrentTab();
    return tab;
  }

  function syncBodyGridClasses() {
    const hasTabs = tabStore.state.tabs.length > 0;
    emptyState.hidden = hasTabs;
    bodyGrid.hidden = !hasTabs;
    sidebar.hidden = !prefs.sidebarOpen;
    const isSplit = tabStore.state.splitMode !== 'off' && hasTabs;
    secondaryPane.hidden = !isSplit;
    bodyGrid.classList.toggle('is-sidebar-collapsed', !prefs.sidebarOpen);
    bodyGrid.classList.toggle('is-split', isSplit);
    notifyState();
  }

  function renderTabsBar() {
    clear(tabList);
    tabStore.state.tabs.forEach((tab) => {
      const selected = tab.id === tabStore.state.activeTabId;
      const tabBtn = el(
        'button',
        {
          type: 'button',
          role: 'tab',
          className: 'reader-tab',
          'aria-selected': String(selected),
          focusgroupstart: selected ? '' : null,
          onClick: async () => {
            tabStore.setActiveTab(tab.id);
            await activateCurrentTab();
          },
          onAuxclick: (e) => {
            if (e.button === 1) closeReaderTab(tab.id);
          }
        },
        el('span', { className: 'reader-tab-title' }, `${tab.dirty ? '• ' : ''}${sanitizeDisplayText(tab.name, 60)}`)
      );
      const closeBtn = el(
        'button',
        {
          type: 'button',
          className: 'reader-tab-close',
          'aria-label': `${sanitizeDisplayText(tab.name, 40)} schließen`,
          onClick: () => closeReaderTab(tab.id)
        },
        '×'
      );
      tabList.appendChild(el('div', { className: 'reader-tab-item', role: 'presentation' }, tabBtn, closeBtn));
      if (selected) {
        requestAnimationFrame(() => tabBtn.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
      }
    });
    if (syncTabListFallback) syncTabListFallback();
  }

  async function closeReaderTab(tabId) {
    const doc = pdfDocsCache.get(tabId);
    if (doc) {
      pdfDocsCache.delete(tabId);
      await destroyPdfDoc(doc);
    }
    tabStore.closeTab(tabId);
    await activateCurrentTab();
  }

  function updateSidebarActiveThumb(pageNumber) {
    sidebarScroll.querySelectorAll('.sidebar-thumb-btn').forEach((btn) => {
      if (Number(btn.dataset.page) === pageNumber) btn.setAttribute('aria-current', 'page');
      else btn.removeAttribute('aria-current');
    });
  }

  async function renderSidebarContent() {
    clear(sidebarScroll);
    const tab = tabStore.getActiveTab();
    if (!tab) return;
    const doc = await ensurePdfDocForTab(tab);

    if (prefs.sidebarTab === 'bookmarks') {
      const outline = await doc.getOutline().catch(() => []);
      if (!outline || outline.length === 0) {
        sidebarScroll.appendChild(el('p', { className: 'caption-copy' }, 'Keine Lesezeichen in diesem Dokument vorhanden.'));
        return;
      }
      const ul = el('ul', { className: 'bookmark-list' });
      const appendNodes = (nodes, depth = 0) => {
        for (const node of nodes) {
          const btn = el(
            'button',
            {
              type: 'button',
              className: 'bookmark-btn',
              style: `padding-left:${0.6 + depth * 0.85}rem`,
              onClick: async () => {
                let targetPage = 1;
                try {
                  let dest = node.dest;
                  if (typeof dest === 'string') dest = await doc.getDestination(dest);
                  if (Array.isArray(dest) && dest[0]) {
                    targetPage = (await doc.getPageIndex(dest[0])) + 1;
                  }
                } catch {
                  targetPage = 1;
                }
                primaryViewport.scrollToPage(targetPage);
              }
            },
            sanitizeDisplayText(node.title || 'Abschnitt', 90)
          );
          ul.appendChild(el('li', {}, btn));
          if (Array.isArray(node.items) && node.items.length) appendNodes(node.items, depth + 1);
        }
      };
      appendNodes(outline);
      sidebarScroll.appendChild(ul);
      return;
    }

    // Thumbnails (lazy rendered when scrolled into sidebar view)
    const maxThumbs = Math.min(doc.numPages, 200);
    for (let p = 1; p <= maxThumbs; p++) {
      const c = el('canvas');
      const btn = el(
        'button',
        {
          type: 'button',
          className: 'sidebar-thumb-btn',
          dataset: { page: String(p) },
          'aria-current': p === tab.currentPage ? 'page' : null,
          onClick: () => primaryViewport.scrollToPage(p)
        },
        c,
        el('span', {}, `Seite ${p}`)
      );
      sidebarScroll.appendChild(btn);
    }
    const thumbObs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const btn = entry.target;
          thumbObs.unobserve(btn);
          const p = Number(btn.dataset.page);
          const c = btn.querySelector('canvas');
          if (c) renderPdfPageToCanvas(doc, p, c, { scale: 0.25 }).catch(() => {});
        }
      },
      { root: sidebarScroll, rootMargin: '200px 0px' }
    );
    sidebarScroll.querySelectorAll('.sidebar-thumb-btn').forEach((b) => thumbObs.observe(b));
  }

  function switchSidebarTab(which) {
    prefs.sidebarTab = which;
    saveReaderPrefs({ sidebarTab: which });
    sidebarThumbsBtn.setAttribute('aria-selected', String(which === 'thumbs'));
    sidebarBookmarksBtn.setAttribute('aria-selected', String(which === 'bookmarks'));
    renderSidebarContent().catch(() => {});
  }

  async function renderSecondaryPane() {
    clear(splitTargetSelect);
    for (const t of tabStore.state.tabs) {
      splitTargetSelect.appendChild(
        el('option', { value: t.id, selected: t.id === tabStore.state.splitSecondTabId }, sanitizeDisplayText(t.name, 40))
      );
    }
    if (tabStore.state.splitMode === 'off') return;
    const targetTab =
      tabStore.state.splitMode === 'same-doc'
        ? tabStore.getActiveTab()
        : tabStore.getTabById(tabStore.state.splitSecondTabId) || tabStore.getActiveTab();
    if (!targetTab) return;
    const doc = await ensurePdfDocForTab(targetTab);
    await secondaryViewport.setLayoutOptions({ readingMode: prefs.readingMode, viewMode: 'single' });
    await secondaryViewport.setDocument(doc, { initialPage: 1 });
  }

  async function activateCurrentTab() {
    renderTabsBar();
    syncBodyGridClasses();
    const tab = tabStore.getActiveTab();
    if (!tab) {
      pageNumInput.value = '1';
      pageTotalSpan.textContent = '/ 0';
      clear(sidebarScroll);
      return;
    }

    const doc = await ensurePdfDocForTab(tab);
    pageTotalSpan.textContent = `/ ${doc.numPages}`;
    pageNumInput.max = String(doc.numPages);
    pageNumInput.value = String(Math.min(doc.numPages, Math.max(1, tab.currentPage)));
    zoomLabelSpan.textContent =
      tab.zoomMode === 'fit-width' ? 'Breite' : tab.zoomMode === 'fit-page' ? 'Seite' : `${Math.round(tab.zoom * 100)} %`;

    await primaryViewport.setLayoutOptions({
      viewMode: prefs.viewMode,
      readingMode: prefs.readingMode,
      zoom: tab.zoom,
      zoomMode: tab.zoomMode,
      rotation: tab.rotation
    });
    await primaryViewport.setDocument(doc, { initialPage: Math.min(doc.numPages, tab.currentPage) });
    await renderSidebarContent();
    await renderSecondaryPane();
    announcePolite(`${tab.name} geöffnet, ${doc.numPages} Seiten.`);
  }

  function jumpPageDelta(delta) {
    const tab = tabStore.getActiveTab();
    if (!tab || !tab.pageCount) return;
    const next = Math.max(1, Math.min(tab.pageCount, tab.currentPage + delta));
    primaryViewport.scrollToPage(next);
  }

  pageNumInput.addEventListener('change', () => {
    const tab = tabStore.getActiveTab();
    if (!tab || !tab.pageCount) return;
    const n = Math.max(1, Math.min(tab.pageCount, Math.trunc(Number(pageNumInput.value) || 1)));
    primaryViewport.scrollToPage(n);
  });

  async function adjustZoom(delta) {
    const tab = tabStore.getActiveTab();
    if (!tab) return;
    const base = tab.zoomMode === 'custom' ? tab.zoom : primaryViewport.getResolvedZoomPercent() / 100;
    tab.zoom = Math.max(0.3, Math.min(3, Math.round((base + delta) * 100) / 100));
    tab.zoomMode = 'custom';
    zoomLabelSpan.textContent = `${Math.round(tab.zoom * 100)} %`;
    await primaryViewport.setLayoutOptions({ zoom: tab.zoom, zoomMode: 'custom' });
  }

  async function setFitMode(mode) {
    const tab = tabStore.getActiveTab();
    if (!tab) return;
    tab.zoomMode = mode;
    zoomLabelSpan.textContent = mode === 'fit-width' ? 'Breite' : 'Seite';
    await primaryViewport.setLayoutOptions({ zoomMode: mode });
  }

  async function rotateView() {
    const tab = tabStore.getActiveTab();
    if (!tab) return;
    tab.rotation = (tab.rotation + 90) % 360;
    await primaryViewport.setLayoutOptions({ rotation: tab.rotation });
  }

  function toggleSidebar() {
    prefs.sidebarOpen = !prefs.sidebarOpen;
    saveReaderPrefs({ sidebarOpen: prefs.sidebarOpen });
    btnSidebar.setAttribute('aria-pressed', String(prefs.sidebarOpen));
    syncBodyGridClasses();
    primaryViewport.refit().catch(() => {});
  }

  function setViewMode(mode) {
    if (!['single', 'two-page', 'book'].includes(mode)) return;
    prefs.viewMode = mode;
    viewModeSelect.value = mode;
    saveReaderPrefs({ viewMode: mode });
    primaryViewport.setLayoutOptions({ viewMode: mode });
    notifyState();
  }

  function setReadingMode(mode) {
    if (!['original', 'sepia', 'night'].includes(mode)) return;
    prefs.readingMode = mode;
    readingModeSelect.value = mode;
    saveReaderPrefs({ readingMode: mode });
    primaryViewport.setLayoutOptions({ readingMode: mode });
    secondaryViewport.setLayoutOptions({ readingMode: mode });
    notifyState();
  }

  function setFullscreenReading(next, { requestNative = false } = {}) {
    fullscreenMode = Boolean(next);
    document.documentElement.classList.toggle('is-fullscreen-reading', fullscreenMode);
    btnFullscreenMode.setAttribute('aria-pressed', String(fullscreenMode));
    fullscreenExitBtn.hidden = !fullscreenMode;
    if (requestNative) {
      if (fullscreenMode && !document.fullscreenElement) {
        document.documentElement.requestFullscreen?.().catch(() => {});
      } else if (!fullscreenMode && document.fullscreenElement) {
        document.exitFullscreen?.().catch(() => {});
      }
    }
    primaryViewport.refit().catch(() => {});
    secondaryViewport.refit().catch(() => {});
    notifyState();
  }

  function onNativeFullscreenChange() {
    if (!document.fullscreenElement && fullscreenMode) {
      setFullscreenReading(false, { requestNative: false });
    }
  }
  document.addEventListener('fullscreenchange', onNativeFullscreenChange);

  async function cycleSplitMode() {
    const tabs = tabStore.state.tabs;
    if (!tabs.length) return;
    const next =
      tabStore.state.splitMode === 'off'
        ? (tabs.length > 1 ? 'two-tabs' : 'same-doc')
        : 'off';
    tabStore.setSplitMode(next);
    btnSplit.setAttribute('aria-pressed', String(next !== 'off'));
    syncBodyGridClasses();
    await primaryViewport.refit();
    await renderSecondaryPane();
  }

  function toggleSearchBar(forceState = null) {
    searchOpen = forceState !== null ? forceState : !searchOpen;
    searchBar.hidden = !searchOpen;
    btnSearchToggle.setAttribute('aria-pressed', String(searchOpen));
    if (searchOpen) {
      searchInput.focus();
      searchInput.select();
    } else {
      currentSearchQuery = '';
      currentMatches = [];
      currentMatchIdx = -1;
      searchStatus.textContent = '0 / 0';
      primaryViewport.setSearchHighlights({ query: '', matches: [], activeMatch: null });
    }
  }

  async function runSearch() {
    const tab = tabStore.getActiveTab();
    if (!tab) return;
    const doc = await ensurePdfDocForTab(tab);
    const res = await searchPdfDocument(doc, searchInput.value);
    currentSearchQuery = res.query;
    currentMatches = res.matches;
    currentMatchIdx = currentMatches.length > 0 ? 0 : -1;
    searchStatus.textContent = currentMatches.length > 0 ? `1 / ${currentMatches.length}` : '0 / 0';
    await primaryViewport.setSearchHighlights({
      query: currentSearchQuery,
      matches: currentMatches,
      activeMatch: currentMatchIdx >= 0 ? currentMatches[currentMatchIdx] : null
    });
  }

  async function stepSearch(delta) {
    if (!currentMatches.length) {
      await runSearch();
      return;
    }
    currentMatchIdx = (currentMatchIdx + delta + currentMatches.length) % currentMatches.length;
    searchStatus.textContent = `${currentMatchIdx + 1} / ${currentMatches.length}`;
    await primaryViewport.setSearchHighlights({
      query: currentSearchQuery,
      matches: currentMatches,
      activeMatch: currentMatches[currentMatchIdx]
    });
  }

  let searchDebounceTimer = null;
  searchInput.addEventListener('input', () => {
    if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
      runSearch();
    }, 120);
  });

  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (currentSearchQuery === searchInput.value.trim() && currentMatches.length > 0) {
        stepSearch(e.shiftKey ? -1 : 1);
      } else {
        runSearch();
      }
    } else if (e.key === 'Escape') {
      toggleSearchBar(false);
    }
  });

  async function handleSave(forceSaveAs) {
    const tab = tabStore.getActiveTab();
    if (!tab) return;
    try {
      const res = await savePdfFile({
        bytes: tab.bytes,
        defaultName: tab.name,
        existingPath: tab.filePath,
        forceSaveAs
      });
      if (res.saved) {
        tabStore.updateTab(tab.id, { filePath: res.path || tab.filePath, name: res.name || tab.name, dirty: false });
        renderTabsBar();
        announcePolite('PDF gespeichert.');
      }
    } catch (err) {
      announceAlert(err instanceof Error ? err.message : 'Speichern fehlgeschlagen.');
    }
  }

  async function handlePrint() {
    const tab = tabStore.getActiveTab();
    if (!tab) return;
    const doc = await ensurePdfDocForTab(tab);
    const stage = document.getElementById('print-stage');
    if (!stage) {
      window.print();
      return;
    }
    clear(stage);
    const maxPrintPages = Math.min(doc.numPages, 80);
    for (let p = 1; p <= maxPrintPages; p++) {
      const c = document.createElement('canvas');
      await renderPdfPageToCanvas(doc, p, c, { scale: 1.75, rotation: tab.rotation });
      stage.appendChild(c);
    }
    window.addEventListener('afterprint', () => clear(stage), { once: true });
    window.print();
  }

  function onKeyDown(e) {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      toggleSearchBar(true);
      return;
    }
    if (mod && e.key.toLowerCase() === 'o') {
      e.preventDefault();
      openFilePicker();
      return;
    }
    if (mod && e.key.toLowerCase() === 's') {
      e.preventDefault();
      handleSave(e.shiftKey);
      return;
    }
    if (mod && e.key.toLowerCase() === 'p') {
      e.preventDefault();
      handlePrint();
      return;
    }
    if (mod && e.key.toLowerCase() === 'w') {
      const tab = tabStore.getActiveTab();
      if (tab) {
        e.preventDefault();
        closeReaderTab(tab.id);
      }
      return;
    }
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.key === 'r' || e.key === 'R') {
      rotateView();
    } else if (e.key === 'F11') {
      e.preventDefault();
      setFullscreenReading(!fullscreenMode, { requestNative: true });
    } else if (e.key === 'Escape' && fullscreenMode) {
      setFullscreenReading(false, { requestNative: true });
    }
  }

  window.addEventListener('keydown', onKeyDown);

  // Drag & drop directly onto reader
  root.addEventListener('dragover', (e) => e.preventDefault());
  root.addEventListener('drop', async (e) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer?.files || []);
    if (!files.length) return;
    const { validatePdfBytes } = await import('../security/file-guard.js');
    for (const f of files) {
      try {
        const cleanName = sanitizeDisplayText(f.name, 90) || 'dokument.pdf';
        const bytes = validatePdfBytes(new Uint8Array(await f.arrayBuffer()), cleanName);
        await openPdfInReader({ name: cleanName, bytes });
      } catch (err) {
        announceAlert(err.message);
      }
    }
  });

  activateCurrentTab();

  return {
    element: root,
    openPdfInReader,
    openFilePicker,
    handleSave,
    handlePrint,
    closeActiveTab: () => {
      const tab = tabStore.getActiveTab();
      if (tab) closeReaderTab(tab.id);
    },
    toggleSidebar,
    setViewMode,
    setReadingMode,
    cycleSplitMode,
    toggleSearchBar,
    rotateView,
    toggleFullscreen: () => setFullscreenReading(!fullscreenMode, { requestNative: true }),
    handoffActiveToTool: (toolId) => {
      const tab = tabStore.getActiveTab();
      onSendToTool(toolId, tab ? { name: tab.name, bytes: tab.bytes, filePath: tab.filePath } : null);
    },
    getMenuState,
    cleanup: async () => {
      window.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('fullscreenchange', onNativeFullscreenChange);
      document.documentElement.classList.remove('is-fullscreen-reading');
      if (document.fullscreenElement) {
        document.exitFullscreen?.().catch(() => {});
      }
      primaryViewport.destroy();
      secondaryViewport.destroy();
      for (const [, doc] of pdfDocsCache) {
        await destroyPdfDoc(doc);
      }
      pdfDocsCache.clear();
    }
  };
}
