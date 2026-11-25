const POS_STORAGE_KEY = 'seelig-pdf-reading-positions';
const PREFS_STORAGE_KEY = 'seelig-pdf-reader-prefs';

export function loadReaderPrefs() {
  try {
    const raw = localStorage.getItem(PREFS_STORAGE_KEY);
    if (!raw) {
      return {
        sidebarOpen: true,
        sidebarTab: 'thumbs',
        readingMode: 'original',
        viewMode: 'single',
        rememberPosition: true
      };
    }
    return {
      sidebarOpen: true,
      sidebarTab: 'thumbs',
      readingMode: 'original',
      viewMode: 'single',
      rememberPosition: true,
      ...JSON.parse(raw)
    };
  } catch {
    return {
      sidebarOpen: true,
      sidebarTab: 'thumbs',
      readingMode: 'original',
      viewMode: 'single',
      rememberPosition: true
    };
  }
}

export function saveReaderPrefs(patch) {
  try {
    const next = { ...loadReaderPrefs(), ...patch };
    localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(next));
    return next;
  } catch {
    return loadReaderPrefs();
  }
}

export async function computeDocHash(bytes) {
  const sample = bytes.subarray(0, Math.min(bytes.byteLength, 256 * 1024));
  const digest = await crypto.subtle.digest('SHA-256', sample);
  const arr = Array.from(new Uint8Array(digest).subarray(0, 12));
  return `${bytes.byteLength}-${arr.map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

export function getSavedReadingPage(docHash) {
  try {
    const map = JSON.parse(localStorage.getItem(POS_STORAGE_KEY) || '{}');
    const p = Number(map[docHash]);
    return Number.isInteger(p) && p >= 1 ? p : 1;
  } catch {
    return 1;
  }
}

export function setSavedReadingPage(docHash, pageNumber) {
  if (!docHash || !Number.isInteger(pageNumber) || pageNumber < 1) return;
  try {
    const map = JSON.parse(localStorage.getItem(POS_STORAGE_KEY) || '{}');
    const keys = Object.keys(map);
    if (keys.length > 40) {
      delete map[keys[0]];
    }
    map[docHash] = pageNumber;
    localStorage.setItem(POS_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // ignore storage quota errors
  }
}

export function clearSavedReadingPositions() {
  try {
    localStorage.removeItem(POS_STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function createReaderTabStore() {
  let seq = 1;
  const listeners = new Set();

  const state = {
    tabs: [],
    activeTabId: null,
    splitMode: 'off', // 'off' | 'same-doc' | 'two-tabs'
    splitSecondTabId: null
  };

  function emit() {
    for (const fn of listeners) fn(state);
  }

  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  function getActiveTab() {
    return state.tabs.find((t) => t.id === state.activeTabId) || null;
  }

  function getTabById(id) {
    return state.tabs.find((t) => t.id === id) || null;
  }

  function openTab({ name, bytes, filePath = null, docHash = null, initialPage = 1 }) {
    // Focus existing tab if same filePath is reopened
    if (filePath) {
      const existing = state.tabs.find((t) => t.filePath === filePath);
      if (existing) {
        state.activeTabId = existing.id;
        emit();
        return existing;
      }
    }

    const tab = {
      id: `tab-${seq++}`,
      name: name || 'dokument.pdf',
      bytes,
      filePath,
      docHash,
      currentPage: initialPage,
      pageCount: 0,
      zoom: 1,
      zoomMode: 'fit-width', // 'fit-width' | 'fit-page' | 'custom'
      rotation: 0,
      dirty: false
    };
    state.tabs.push(tab);
    state.activeTabId = tab.id;
    if (!state.splitSecondTabId && state.tabs.length > 1) {
      state.splitSecondTabId = state.tabs[0].id === tab.id ? state.tabs[1].id : state.tabs[0].id;
    }
    emit();
    return tab;
  }

  function setActiveTab(id) {
    if (!state.tabs.some((t) => t.id === id)) return;
    state.activeTabId = id;
    emit();
  }

  function updateTab(id, patch) {
    const tab = getTabById(id);
    if (!tab) return;
    Object.assign(tab, patch);
    emit();
  }

  function closeTab(id) {
    const idx = state.tabs.findIndex((t) => t.id === id);
    if (idx === -1) return;
    state.tabs.splice(idx, 1);

    if (state.activeTabId === id) {
      const fallback = state.tabs[Math.min(idx, state.tabs.length - 1)] || null;
      state.activeTabId = fallback ? fallback.id : null;
    }
    if (state.splitSecondTabId === id) {
      const other = state.tabs.find((t) => t.id !== state.activeTabId) || state.tabs[0] || null;
      state.splitSecondTabId = other ? other.id : null;
      if (state.tabs.length < 2 && state.splitMode === 'two-tabs') {
        state.splitMode = state.tabs.length === 1 ? 'same-doc' : 'off';
      }
    }
    if (state.tabs.length === 0) {
      state.splitMode = 'off';
    }
    emit();
  }

  function setSplitMode(mode) {
    state.splitMode = mode;
    if (mode === 'two-tabs') {
      const other = state.tabs.find((t) => t.id !== state.activeTabId) || state.tabs[0] || null;
      state.splitSecondTabId = other ? other.id : null;
    }
    emit();
  }

  function setSplitSecondTab(id) {
    state.splitSecondTabId = id;
    emit();
  }

  return {
    state,
    subscribe,
    getActiveTab,
    getTabById,
    openTab,
    setActiveTab,
    updateTab,
    closeTab,
    setSplitMode,
    setSplitSecondTab
  };
}
