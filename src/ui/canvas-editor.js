import { clear, el } from './dom.js';
import { destroyPdfDoc, openHardenedPdfDocument, renderPdfPageToCanvas } from '../engine/pdf-render.js';

export function createSignaturePad({ onChange = () => {} } = {}) {
  const canvas = el('canvas', { className: 'signature-pad', width: 480, height: 160 });
  const ctx = canvas.getContext('2d');
  let drawing = false;
  let hasInk = false;

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#121212';

  function getPos(e) {
    const r = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * canvas.width,
      y: ((e.clientY - r.top) / r.height) * canvas.height
    };
  }

  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    drawing = true;
    const p = getPos(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!drawing) return;
    const p = getPos(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    hasInk = true;
  });

  const endStroke = () => {
    if (!drawing) return;
    drawing = false;
    onChange(hasInk);
  };
  canvas.addEventListener('pointerup', endStroke);
  canvas.addEventListener('pointercancel', endStroke);

  function reset() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    hasInk = false;
    onChange(false);
  }

  async function toPngBytes() {
    if (!hasInk) return null;
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
  }

  return { element: canvas, reset, toPngBytes, hasInk: () => hasInk };
}

export function createInteractivePdfStage({
  mode = 'redact', // 'redact' | 'annotate' | 'sign' | 'crop'
  boxClass = 'stage-box--redact',
  onBoxesChange = () => {}
} = {}) {
  const wrapper = el('div', { className: 'form-stack' });
  const navRow = el('div', { className: 'workspace-topbar' });
  const pageLabel = el('span', { className: 'muted-copy' }, 'Noch keine PDF geladen');
  const prevBtn = el('button', { type: 'button', className: 'icon-btn', disabled: true, 'aria-label': 'Vorherige Seite' }, '‹');
  const nextBtn = el('button', { type: 'button', className: 'icon-btn', disabled: true, 'aria-label': 'Nächste Seite' }, '›');
  navRow.append(el('div', { className: 'file-item-actions' }, prevBtn, nextBtn), pageLabel);

  const pdfCanvas = el('canvas');
  const overlayLayer = el('div', { className: 'canvas-overlay-interactive' });
  const stage = el('div', { className: 'canvas-stage' }, pdfCanvas, overlayLayer);
  const stageWrap = el('div', { className: 'canvas-stage-wrap' }, stage);
  const boxList = el('ul', { className: 'file-list' });

  let pdfDoc = null;
  let currentPage = 1;
  let boxes = []; // { id, pageNumber, x, y, w, h, label, payload }
  let dragStart = null;
  let previewEl = null;
  let activePayloadProvider = () => ({ label: 'Bereich' });

  function renderOverlays() {
    clear(overlayLayer);
    clear(boxList);

    const pageBoxes = boxes.filter((b) => b.pageNumber === currentPage);
    for (const b of pageBoxes) {
      const boxDiv = el('div', {
        className: `stage-box ${boxClass}`,
        style: `left:${(b.x * 100).toFixed(2)}%;top:${(b.y * 100).toFixed(2)}%;width:${(b.w * 100).toFixed(2)}%;height:${(b.h * 100).toFixed(2)}%;`
      });
      overlayLayer.appendChild(boxDiv);
    }

    boxes.forEach((b, idx) => {
      boxList.appendChild(
        el(
          'li',
          { className: 'file-item' },
          el('span', { className: 'file-item-name' }, `Seite ${b.pageNumber} · ${b.label} (${Math.round(b.w * 100)}% × ${Math.round(b.h * 100)}%)`),
          el(
            'button',
            {
              type: 'button',
              className: 'icon-btn',
              'aria-label': `Markierung ${idx + 1} entfernen`,
              onClick: () => {
                boxes = boxes.filter((item) => item.id !== b.id);
                renderOverlays();
                onBoxesChange(boxes);
              }
            },
            '×'
          )
        )
      );
    });
  }

  async function showPage(num) {
    if (!pdfDoc) return;
    currentPage = Math.max(1, Math.min(pdfDoc.numPages, num));
    prevBtn.disabled = currentPage <= 1;
    nextBtn.disabled = currentPage >= pdfDoc.numPages;
    pageLabel.textContent = `Seite ${currentPage} von ${pdfDoc.numPages}`;
    await renderPdfPageToCanvas(pdfDoc, currentPage, pdfCanvas, { scale: 1.35 });
    renderOverlays();
  }

  prevBtn.addEventListener('click', () => showPage(currentPage - 1));
  nextBtn.addEventListener('click', () => showPage(currentPage + 1));

  function relCoords(e) {
    const r = overlayLayer.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (e.clientX - r.left) / Math.max(1, r.width))),
      y: Math.max(0, Math.min(1, (e.clientY - r.top) / Math.max(1, r.height)))
    };
  }

  overlayLayer.addEventListener('pointerdown', (e) => {
    if (!pdfDoc) return;
    e.preventDefault();
    try {
      overlayLayer.setPointerCapture(e.pointerId);
    } catch {
      // ignore if pointer capture unavailable
    }
    dragStart = relCoords(e);
    previewEl = el('div', { className: `stage-box ${boxClass}` });
    overlayLayer.appendChild(previewEl);
  });

  overlayLayer.addEventListener('pointermove', (e) => {
    if (!dragStart || !previewEl) return;
    const cur = relCoords(e);
    const x = Math.min(dragStart.x, cur.x);
    const y = Math.min(dragStart.y, cur.y);
    const w = Math.abs(cur.x - dragStart.x);
    const h = Math.abs(cur.y - dragStart.y);
    previewEl.style.left = `${x * 100}%`;
    previewEl.style.top = `${y * 100}%`;
    previewEl.style.width = `${w * 100}%`;
    previewEl.style.height = `${h * 100}%`;
  });

  overlayLayer.addEventListener('pointerup', (e) => {
    if (!dragStart) return;
    const cur = relCoords(e);
    let x = Math.min(dragStart.x, cur.x);
    let y = Math.min(dragStart.y, cur.y);
    let w = Math.abs(cur.x - dragStart.x);
    let h = Math.abs(cur.y - dragStart.y);
    dragStart = null;
    if (previewEl) {
      previewEl.remove();
      previewEl = null;
    }

    // For click-placement in sign/annotate mode, provide default box size
    if (w < 0.015 && h < 0.015 && (mode === 'sign' || mode === 'annotate')) {
      w = mode === 'sign' ? 0.28 : 0.25;
      h = mode === 'sign' ? 0.1 : 0.08;
      x = Math.min(1 - w, x);
      y = Math.min(1 - h, y);
    }
    if (w < 0.01 || h < 0.01) return;

    const extra = activePayloadProvider(currentPage) || {};
    const entry = {
      id: `${Date.now()}-${crypto.randomUUID()}`,
      pageNumber: currentPage,
      x,
      y,
      w,
      h,
      label: extra.label || 'Markierung',
      payload: extra
    };
    if (mode === 'crop') {
      boxes = [entry];
    } else {
      boxes.push(entry);
    }
    renderOverlays();
    onBoxesChange(boxes);
  });

  async function loadPdf(bytes) {
    if (pdfDoc) {
      await destroyPdfDoc(pdfDoc);
      pdfDoc = null;
    }
    boxes = [];
    pdfDoc = await openHardenedPdfDocument(bytes);
    await showPage(1);
    onBoxesChange(boxes);
  }

  wrapper.append(navRow, stageWrap, boxList);

  return {
    element: wrapper,
    loadPdf,
    setPayloadProvider: (fn) => {
      activePayloadProvider = fn;
    },
    getBoxes: () => boxes,
    getCurrentPage: () => currentPage,
    addBoxManual: (entry) => {
      boxes.push({ id: crypto.randomUUID(), pageNumber: currentPage, ...entry });
      renderOverlays();
      onBoxesChange(boxes);
    },
    clearBoxes: () => {
      boxes = [];
      renderOverlays();
      onBoxesChange(boxes);
    },
    cleanup: async () => {
      if (pdfDoc) {
        await destroyPdfDoc(pdfDoc);
        pdfDoc = null;
      }
    }
  };
}
