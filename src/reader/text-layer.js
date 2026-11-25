import { clear } from '../ui/dom.js';

function multiplyTransform(m1, m2) {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5]
  ];
}

function appendHighlightedText(span, text, queryLower, itemMatches, activeMatchRef) {
  if (!queryLower || !itemMatches || itemMatches.length === 0) {
    span.textContent = text;
    return;
  }

  let cursor = 0;
  for (const m of itemMatches) {
    if (m.offset > cursor) {
      span.appendChild(document.createTextNode(text.slice(cursor, m.offset)));
    }
    const mark = document.createElement('mark');
    const isCurrent = activeMatchRef && activeMatchRef === m;
    mark.className = isCurrent ? 'reader-match is-current' : 'reader-match';
    mark.textContent = text.slice(m.offset, m.offset + m.length);
    span.appendChild(mark);
    cursor = m.offset + m.length;
  }
  if (cursor < text.length) {
    span.appendChild(document.createTextNode(text.slice(cursor)));
  }
}

export function renderSafeTextLayer({
  container,
  textContent,
  viewport,
  searchQuery = '',
  pageMatches = [],
  activeMatchRef = null
}) {
  clear(container);
  container.style.width = `${viewport.width}px`;
  container.style.height = `${viewport.height}px`;

  const queryLower = String(searchQuery || '').trim().toLowerCase();
  const byItem = new Map();
  for (const m of pageMatches) {
    if (!byItem.has(m.itemIndex)) byItem.set(m.itemIndex, []);
    byItem.get(m.itemIndex).push(m);
  }

  const frag = document.createDocumentFragment();
  textContent.items.forEach((item, idx) => {
    if (!('str' in item) || !item.str) return;
    const tx = multiplyTransform(viewport.transform, item.transform);
    const fontHeight = Math.max(8, Math.hypot(tx[2], tx[3]));
    const left = tx[4];
    const top = tx[5] - fontHeight * 0.88;
    const angle = Math.atan2(tx[1], tx[0]);

    const span = document.createElement('span');
    span.className = 'reader-text-span';
    span.style.left = `${left.toFixed(1)}px`;
    span.style.top = `${top.toFixed(1)}px`;
    span.style.fontSize = `${fontHeight.toFixed(1)}px`;
    if (Math.abs(angle) > 0.01) {
      span.style.transform = `rotate(${angle.toFixed(3)}rad)`;
    }

    appendHighlightedText(span, item.str, queryLower, byItem.get(idx), activeMatchRef);
    frag.appendChild(span);
  });

  container.appendChild(frag);
}
