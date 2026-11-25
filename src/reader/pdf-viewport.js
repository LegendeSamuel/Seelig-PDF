import { clear, el } from '../ui/dom.js';
import { MAX_CANVAS_DIM, MAX_CANVAS_PIXELS } from '../security/limits.js';
import { renderSafeTextLayer } from './text-layer.js';

export function buildSpreadLayout(numPages, viewMode = 'single') {
  const spreads = [];
  if (viewMode === 'single') {
    for (let p = 1; p <= numPages; p++) spreads.push([p]);
    return spreads;
  }
  if (viewMode === 'book') {
    if (numPages >= 1) spreads.push([1]);
    for (let p = 2; p <= numPages; p += 2) {
      spreads.push(p + 1 <= numPages ? [p, p + 1] : [p]);
    }
    return spreads;
  }
  // two-page
  for (let p = 1; p <= numPages; p += 2) {
    spreads.push(p + 1 <= numPages ? [p, p + 1] : [p]);
  }
  return spreads;
}

export function createPdfViewport({
  onCurrentPageChange = () => {},
  onError = () => {}
} = {}) {
  const scroller = el('div', { className: 'reader-viewport-scroller', tabindex: '0' });
  const pagesHost = el('div', { className: 'reader-pages-host' });
  scroller.appendChild(pagesHost);

  let pdfDoc = null;
  let currentMode = 'single';
  let currentReadingMode = 'original';
  let currentZoom = 1;
  let currentZoomMode = 'fit-width'; // 'fit-width' | 'fit-page' | 'custom'
  let currentRotation = 0;
  let searchQuery = '';
  let searchMatches = [];
  let activeMatch = null;
  let observer = null;

  const pageSlots = new Map(); // pageNum -> { wrap, canvas, textLayer, renderState, baseWidth, baseHeight }
  const activeRenderQueue = new Set();
  let renderGeneration = 0;

  function computeScaleForPage(baseW, baseH) {
    const availW = Math.max(220, scroller.clientWidth - (currentMode === 'single' ? 48 : 96));
    const availH = Math.max(300, scroller.clientHeight - 48);
    let scale = currentZoom;
    if (currentZoomMode === 'fit-width') {
      const targetW = currentMode === 'single' ? availW : availW / 2;
      scale = targetW / baseW;
    } else if (currentZoomMode === 'fit-page') {
      const targetW = currentMode === 'single' ? availW : availW / 2;
      scale = Math.min(targetW / baseW, availH / baseH);
    }
    scale = Math.max(0.25, Math.min(3.5, scale));

    const maxDimScale = Math.min(MAX_CANVAS_DIM / baseW, MAX_CANVAS_DIM / baseH);
    if (scale > maxDimScale) scale = maxDimScale;
    const area = baseW * scale * (baseH * scale);
    if (area > MAX_CANVAS_PIXELS) {
      scale *= Math.sqrt(MAX_CANVAS_PIXELS / area);
    }
    return scale;
  }

  function applyReadingModeClass() {
    pagesHost.dataset.readingMode = currentReadingMode;
  }

  function releaseFarCanvases(visibleSet) {
    if (pageSlots.size <= 16) return;
    for (const [pNum, slot] of pageSlots.entries()) {
      const minVis = Math.min(...visibleSet);
      const maxVis = Math.max(...visibleSet);
      if (pNum < minVis - 3 || pNum > maxVis + 3) {
        if (slot.rendered) {
          slot.canvas.width = 0;
          slot.canvas.height = 0;
          clear(slot.textLayer);
          slot.rendered = false;
        }
      }
    }
  }

  async function renderSlot(pageNumber, slot, gen = renderGeneration) {
    const docRef = pdfDoc;
    const queueKey = `${gen}:${pageNumber}`;
    if (!docRef || slot.rendered || gen !== renderGeneration || activeRenderQueue.has(queueKey)) return;
    activeRenderQueue.add(queueKey);
    try {
      const page = await docRef.getPage(pageNumber);
      try {
        if (gen !== renderGeneration || pdfDoc !== docRef) return;
        const rot = (page.rotate + currentRotation) % 360;
        const base = page.getViewport({ scale: 1, rotation: rot });
        const scale = computeScaleForPage(base.width, base.height);
        const viewport = page.getViewport({ scale, rotation: rot });

        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const targetW = Math.max(1, Math.floor(viewport.width));
        const targetH = Math.max(1, Math.floor(viewport.height));

        slot.wrap.style.width = `${targetW}px`;
        slot.wrap.style.height = `${targetH}px`;
        slot.canvas.width = Math.min(MAX_CANVAS_DIM, Math.floor(targetW * dpr));
        slot.canvas.height = Math.min(MAX_CANVAS_DIM, Math.floor(targetH * dpr));
        slot.canvas.style.width = `${targetW}px`;
        slot.canvas.height = slot.canvas.height;
        slot.canvas.style.height = `${targetH}px`;

        const ctx = slot.canvas.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, targetW, targetH);

        await page.render({ canvasContext: ctx, viewport }).promise;
        if (gen !== renderGeneration || pdfDoc !== docRef) return;

        const textContent = await page.getTextContent();
        if (gen !== renderGeneration || pdfDoc !== docRef) return;
        const pageMatches = searchMatches.filter((m) => m.pageNumber === pageNumber);
        renderSafeTextLayer({
          container: slot.textLayer,
          textContent,
          viewport,
          searchQuery,
          pageMatches,
          activeMatchRef: activeMatch
        });

        slot.rendered = true;
      } finally {
        page.cleanup();
      }
    } catch (err) {
      if (gen === renderGeneration) {
        onError(err instanceof Error ? err.message : 'Fehler beim Rendern der Seite.');
      }
    } finally {
      activeRenderQueue.delete(queueKey);
    }
  }

  async function buildDomSlots() {
    const gen = ++renderGeneration;
    activeRenderQueue.clear();
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    clear(pagesHost);
    pageSlots.clear();
    const docRef = pdfDoc;
    if (!docRef) return;

    const firstPage = await docRef.getPage(1);
    const firstRot = (firstPage.rotate + currentRotation) % 360;
    const baseVp = firstPage.getViewport({ scale: 1, rotation: firstRot });
    firstPage.cleanup();
    if (gen !== renderGeneration || pdfDoc !== docRef) return;

    const estScale = computeScaleForPage(baseVp.width, baseVp.height);
    const estW = Math.round(baseVp.width * estScale);
    const estH = Math.round(baseVp.height * estScale);

    const spreads = buildSpreadLayout(pdfDoc.numPages, currentMode);
    for (const pair of spreads) {
      const spreadRow = el('div', { className: 'reader-spread' });
      for (const pageNum of pair) {
        const canvas = el('canvas', { className: 'reader-page-canvas' });
        const textLayer = el('div', { className: 'reader-text-layer' });
        const badge = el('span', { className: 'reader-page-badge' }, String(pageNum));
        const wrap = el(
          'div',
          {
            className: 'reader-page-frame',
            dataset: { pageNumber: String(pageNum) },
            style: `width:${estW}px;height:${estH}px;`
          },
          canvas,
          textLayer,
          badge
        );
        pageSlots.set(pageNum, { wrap, canvas, textLayer, rendered: false });
        spreadRow.appendChild(wrap);
      }
      pagesHost.appendChild(spreadRow);
    }

    const visibleSet = new Set();
    observer = new IntersectionObserver(
      (entries) => {
        if (gen !== renderGeneration) return;
        for (const entry of entries) {
          const pNum = Number(entry.target.dataset.pageNumber);
          const slot = pageSlots.get(pNum);
          if (!slot) continue;
          if (entry.isIntersecting) {
            visibleSet.add(pNum);
            renderSlot(pNum, slot, gen);
          } else {
            visibleSet.delete(pNum);
          }
        }
        if (visibleSet.size > 0) {
          const firstVisible = Math.min(...visibleSet);
          onCurrentPageChange(firstVisible);
          releaseFarCanvases(visibleSet);
        }
      },
      { root: scroller, rootMargin: '600px 0px', threshold: 0.05 }
    );

    for (const [, slot] of pageSlots) {
      observer.observe(slot.wrap);
    }
    applyReadingModeClass();
  }

  async function setDocument(doc, { initialPage = 1 } = {}) {
    pdfDoc = doc;
    await buildDomSlots();
    if (initialPage > 1) {
      scrollToPage(initialPage);
    }
  }

  function scrollToPage(pageNumber) {
    const slot = pageSlots.get(pageNumber);
    if (!slot) return;
    slot.wrap.scrollIntoView({ behavior: 'auto', block: 'start' });
    renderSlot(pageNumber, slot);
    onCurrentPageChange(pageNumber);
  }

  async function setLayoutOptions({ viewMode, readingMode, zoom, zoomMode, rotation } = {}) {
    let needsRebuild = false;
    if (viewMode && viewMode !== currentMode) {
      currentMode = viewMode;
      needsRebuild = true;
    }
    if (zoom !== undefined && zoom !== currentZoom) {
      currentZoom = zoom;
      needsRebuild = true;
    }
    if (zoomMode && zoomMode !== currentZoomMode) {
      currentZoomMode = zoomMode;
      needsRebuild = true;
    }
    if (rotation !== undefined && rotation !== currentRotation) {
      currentRotation = ((rotation % 360) + 360) % 360;
      needsRebuild = true;
    }
    if (readingMode && readingMode !== currentReadingMode) {
      currentReadingMode = readingMode;
      applyReadingModeClass();
    }
    if (needsRebuild && pdfDoc) {
      await buildDomSlots();
    }
  }

  async function setSearchHighlights({ query, matches, activeMatch: active }) {
    searchQuery = query || '';
    searchMatches = matches || [];
    activeMatch = active || null;
    for (const [pNum, slot] of pageSlots.entries()) {
      if (slot.rendered) {
        slot.rendered = false;
        await renderSlot(pNum, slot);
      }
    }
    if (activeMatch) {
      scrollToPage(activeMatch.pageNumber);
    }
  }

  function getResolvedZoomPercent() {
    const firstSlot = pageSlots.get(1);
    if (!firstSlot || !pdfDoc) return Math.round(currentZoom * 100);
    return Math.round((parseFloat(firstSlot.wrap.style.width) / 595.28) * 100);
  }

  let lastScrollerW = 0;
  let resizeTimer = null;
  const resizeObs =
    typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver((entries) => {
          const w = entries[0]?.contentRect?.width || 0;
          if (!pdfDoc || currentZoomMode === 'custom' || Math.abs(w - lastScrollerW) < 12) return;
          lastScrollerW = w;
          if (resizeTimer) clearTimeout(resizeTimer);
          resizeTimer = setTimeout(() => {
            if (pdfDoc) buildDomSlots().catch(() => {});
          }, 90);
        })
      : null;
  if (resizeObs) resizeObs.observe(scroller);

  async function refit() {
    if (!pdfDoc || currentZoomMode === 'custom') return;
    lastScrollerW = scroller.clientWidth;
    await buildDomSlots();
  }

  function destroy() {
    renderGeneration++;
    activeRenderQueue.clear();
    if (resizeObs) resizeObs.disconnect();
    if (resizeTimer) clearTimeout(resizeTimer);
    if (observer) observer.disconnect();
    for (const [, slot] of pageSlots) {
      slot.canvas.width = 0;
      slot.canvas.height = 0;
    }
    pageSlots.clear();
    clear(pagesHost);
    pdfDoc = null;
  }

  return {
    element: scroller,
    setDocument,
    scrollToPage,
    setLayoutOptions,
    setSearchHighlights,
    getResolvedZoomPercent,
    refit,
    destroy
  };
}
