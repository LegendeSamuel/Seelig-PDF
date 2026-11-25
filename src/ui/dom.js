const SVG_NS = 'http://www.w3.org/2000/svg';

const ICON_PATHS = {
  shield: [
    'M12 3l7 3v5c0 4.8-3 8.9-7 10-4-1.1-7-5.2-7-10V6l7-3z',
    'M9.5 12.2l1.8 1.8 3.5-3.8'
  ],
  merge: ['M7 4v10a3 3 0 0 0 3 3h7', 'M17 4v5', 'M14 14l3 3-3 3', 'M5 6l2-2 2 2', 'M15 6l2-2 2 2'],
  split: ['M4 12h7', 'M13 12h7', 'M11 6v12', 'M17 9l3 3-3 3', 'M7 9l-3 3 3 3'],
  sort: ['M4 6h16', 'M4 12h10', 'M4 18h6', 'M17 11v8', 'M14 16l3 3 3-3'],
  trash: ['M4 7h16', 'M9 7V4h6v3', 'M7 7l1 13h8l1-13', 'M10 11v6', 'M14 11v6'],
  export: ['M14 3h6v6', 'M10 14L20 4', 'M20 13v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h6'],
  rotate: ['M20 12a8 8 0 1 1-2.3-5.6', 'M20 4v5h-5'],
  grid: ['M4 4h7v7H4z', 'M13 4h7v7h-7z', 'M4 13h7v7H4z', 'M13 13h7v7h-7z'],
  book: ['M4 5h6a2 2 0 0 1 2 2v12a2 2 0 0 0-2-2H4z', 'M20 5h-6a2 2 0 0 0-2 2v12a2 2 0 0 1 2-2h6z'],
  scissors: ['M6 6a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z', 'M6 13a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z', 'M8.2 7.5L19 16', 'M8.2 16.5L19 8'],
  stamp: ['M5 19h14', 'M6 16h12v-2a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v2z', 'M10 12V8a2 2 0 1 1 4 0v4'],
  hash: ['M5 9h14', 'M5 15h14', 'M10 4L8 20', 'M16 4l-2 16'],
  layers: ['M12 3l9 4.5-9 4.5-9-4.5z', 'M3 12l9 4.5 9-4.5', 'M3 16.5l9 4.5 9-4.5'],
  crop: ['M6 3v13a2 2 0 0 0 2 2h13', 'M3 6h13a2 2 0 0 1 2 2v13'],
  resize: ['M15 4h5v5', 'M9 20H4v-5', 'M20 4l-6 6', 'M4 20l6-6'],
  pen: ['M4 20h4l10-10a2.8 2.8 0 0 0-4-4L4 16v4z', 'M13 7l4 4'],
  edit: ['M4 5h12', 'M4 11h8', 'M4 17h6', 'M14 19l5-5-2-2-5 5v2z'],
  form: ['M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z', 'M8 9h8', 'M8 13h8', 'M8 17h5'],
  bookmark: ['M6 4h12v17l-6-4-6 4z'],
  info: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 11v6', 'M12 8h.01'],
  image: ['M4 5h16v14H4z', 'M8.5 9.5a1.5 1.5 0 1 0 0 .01', 'M4 16l5-5 4 4 3-3 4 4'],
  text: ['M6 4h9l5 5v11H6z', 'M15 4v5h5', 'M9 13h6', 'M9 17h6'],
  qr: ['M4 4h6v6H4z', 'M14 4h6v6h-6z', 'M4 14h6v6H4z', 'M14 14h2v2h-2z', 'M18 14h2v6h-4v-2', 'M14 18h2'],
  compress: ['M4 14h6v6', 'M20 10h-6V4', 'M14 10l6-6', 'M4 20l6-6'],
  lock: ['M6 11h12v9H6z', 'M8 11V7a4 4 0 1 1 8 0v4'],
  unlock: ['M6 11h12v9H6z', 'M8 11V7a4 4 0 0 1 7.6-1.7'],
  redact: ['M3 6h18v12H3z', 'M6 10h12v4H6z'],
  sparkle: ['M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z'],
  diff: ['M4 5h7v14H4z', 'M13 5h7v14h-7z', 'M7 10h1', 'M16 10h1', 'M16 14h1'],
  search: ['M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z', 'M20 20l-3.5-3.5'],
  upload: ['M12 16V4', 'M7 9l5-5 5 5', 'M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2'],
  download: ['M12 4v12', 'M7 11l5 5 5-5', 'M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2']
};

export function svgIcon(name, size = 20) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');

  const paths = ICON_PATHS[name] || ICON_PATHS.text;
  for (const d of paths) {
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', d);
    svg.appendChild(p);
  }
  return svg;
}

export function clear(node) {
  while (node.firstChild) {
    node.removeChild(node.firstChild);
  }
  return node;
}

export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  if (props && typeof props === 'object') {
    for (const [key, val] of Object.entries(props)) {
      if (val === undefined || val === null || val === false) continue;
      if (key === 'className') {
        node.className = String(val);
      } else if (key === 'style') {
        if (typeof val === 'string') {
          for (const decl of val.split(';')) {
            const colonIdx = decl.indexOf(':');
            if (colonIdx === -1) continue;
            const prop = decl.slice(0, colonIdx).trim();
            const propVal = decl.slice(colonIdx + 1).trim();
            if (prop) node.style.setProperty(prop, propVal);
          }
        } else if (typeof val === 'object') {
          for (const [sk, sv] of Object.entries(val)) {
            if (sv === undefined || sv === null) continue;
            if (sk.includes('-')) node.style.setProperty(sk, String(sv));
            else node.style[sk] = String(sv);
          }
        }
      } else if (key === 'dataset' && typeof val === 'object') {
        for (const [dk, dv] of Object.entries(val)) {
          if (dv !== undefined && dv !== null) node.dataset[dk] = String(dv);
        }
      } else if (key.startsWith('on') && typeof val === 'function') {
        node.addEventListener(key.slice(2).toLowerCase(), val);
      } else if (key === 'htmlFor') {
        node.setAttribute('for', String(val));
      } else if (
        key === 'disabled' ||
        key === 'checked' ||
        key === 'required' ||
        key === 'hidden' ||
        key === 'selected' ||
        key === 'multiple' ||
        key === 'autofocus'
      ) {
        node[key] = Boolean(val);
      } else if (key === 'value') {
        node.value = String(val);
      } else {
        node.setAttribute(key, String(val));
      }
    }
  }
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    if (child instanceof Node) {
      node.appendChild(child);
    } else {
      node.appendChild(document.createTextNode(String(child)));
    }
  }
  return node;
}
