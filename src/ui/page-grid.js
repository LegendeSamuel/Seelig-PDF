import { clear, el } from './dom.js';
import { destroyPdfDoc, openHardenedPdfDocument, renderPdfPageToCanvas } from '../engine/pdf-render.js';

export function createPageGrid({
  selectable = true,
  reorderable = false,
  rotatable = false,
  deletable = false,
  duplicable = false,
  onChange = () => {},
  onInspectPage = null
} = {}) {
  const container = el('div', { className: 'page-grid' });
  let items = [];
  let loadedDocs = [];

  async function cleanupDocs() {
    for (const d of loadedDocs) {
      await destroyPdfDoc(d);
    }
    loadedDocs = [];
  }

  async function loadFromFiles(fileItems) {
    await cleanupDocs();
    items = [];
    for (let fIdx = 0; fIdx < fileItems.length; fIdx++) {
      const doc = await openHardenedPdfDocument(fileItems[fIdx].bytes);
      loadedDocs.push(doc);
      for (let p = 0; p < doc.numPages; p++) {
        items.push({
          uid: `${fIdx}-${p}-${Math.random().toString(36).slice(2, 7)}`,
          fileIndex: fIdx,
          fileName: fileItems[fIdx].name,
          pageIndex: p,
          pageNumber: p + 1,
          rotateDeg: 0,
          selected: false
        });
      }
    }
    await render();
    onChange(items);
  }

  async function render() {
    clear(container);
    for (let idx = 0; idx < items.length; idx++) {
      const item = items[idx];
      const canvas = el('canvas');
      const canvasWrap = el('div', { className: 'page-thumb-canvas-wrap' }, canvas);

      const doc = loadedDocs[item.fileIndex];
      if (doc) {
        renderPdfPageToCanvas(doc, item.pageNumber, canvas, {
          scale: 0.45,
          rotation: item.rotateDeg
        }).catch(() => {});
      }

      const controls = el('div', { className: 'page-thumb-controls' });

      if (selectable) {
        controls.appendChild(
          el(
            'button',
            {
              type: 'button',
              className: 'icon-btn',
              'aria-pressed': String(item.selected),
              'aria-label': `Seite ${item.pageNumber} auswählen`,
              onClick: () => {
                item.selected = !item.selected;
                card.classList.toggle('is-selected', item.selected);
                onChange(items);
              }
            },
            item.selected ? '✓' : '+'
          )
        );
      }

      if (reorderable) {
        controls.appendChild(
          el(
            'button',
            {
              type: 'button',
              className: 'icon-btn',
              disabled: idx === 0,
              'aria-label': `Seite ${item.pageNumber} nach links`,
              onClick: async () => {
                [items[idx - 1], items[idx]] = [items[idx], items[idx - 1]];
                await render();
                onChange(items);
              }
            },
            '‹'
          )
        );
        controls.appendChild(
          el(
            'button',
            {
              type: 'button',
              className: 'icon-btn',
              disabled: idx === items.length - 1,
              'aria-label': `Seite ${item.pageNumber} nach rechts`,
              onClick: async () => {
                [items[idx + 1], items[idx]] = [items[idx], items[idx + 1]];
                await render();
                onChange(items);
              }
            },
            '›'
          )
        );
      }

      if (rotatable) {
        controls.appendChild(
          el(
            'button',
            {
              type: 'button',
              className: 'icon-btn',
              'aria-label': `Seite ${item.pageNumber} um 90 Grad drehen`,
              onClick: async () => {
                item.rotateDeg = (item.rotateDeg + 90) % 360;
                await render();
                onChange(items);
              }
            },
            '↻'
          )
        );
      }

      if (duplicable) {
        controls.appendChild(
          el(
            'button',
            {
              type: 'button',
              className: 'icon-btn',
              'aria-label': `Seite ${item.pageNumber} duplizieren`,
              onClick: async () => {
                items.splice(idx + 1, 0, {
                  ...item,
                  uid: `${item.fileIndex}-${item.pageIndex}-${Math.random().toString(36).slice(2, 7)}`
                });
                await render();
                onChange(items);
              }
            },
            '⊕'
          )
        );
      }

      if (deletable) {
        controls.appendChild(
          el(
            'button',
            {
              type: 'button',
              className: 'icon-btn',
              disabled: items.length <= 1,
              'aria-label': `Seite ${item.pageNumber} entfernen`,
              onClick: async () => {
                if (items.length <= 1) return;
                items.splice(idx, 1);
                await render();
                onChange(items);
              }
            },
            '×'
          )
        );
      }

      if (onInspectPage) {
        controls.appendChild(
          el(
            'button',
            {
              type: 'button',
              className: 'icon-btn',
              'aria-label': `Seite ${item.pageNumber} vergrößern`,
              onClick: () => onInspectPage(doc, item.pageNumber)
            },
            '⌕'
          )
        );
      }

      const card = el(
        'div',
        { className: `page-thumb${item.selected ? ' is-selected' : ''}` },
        canvasWrap,
        el(
          'div',
          { className: 'page-thumb-bar' },
          el('span', {}, `Seite ${item.pageNumber}${item.rotateDeg ? ` (${item.rotateDeg}°)` : ''}`)
        ),
        controls
      );

      container.appendChild(card);
    }
  }

  return {
    element: container,
    loadFromFiles,
    getItems: () => items,
    getSelectedPageNumbers: () => items.filter((i) => i.selected).map((i) => i.pageNumber),
    cleanup: cleanupDocs
  };
}
