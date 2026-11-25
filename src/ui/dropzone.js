import { clear, el, svgIcon } from './dom.js';
import { formatBytes, sanitizeDisplayText } from '../security/sanitize.js';
import { validateBatchFiles, validateImageBytes, validatePdfBytes, validateTextBytes } from '../security/file-guard.js';

export function createDropzone({
  id = 'tool-file-input',
  accept = '.pdf,application/pdf',
  kind = 'pdf', // 'pdf' | 'image' | 'text'
  multiple = false,
  label = 'Dateien auswählen oder hierher ziehen',
  hint = 'Maximal 100 MB pro Datei · Verarbeitung bleibt lokal im Browser',
  onFilesChange = () => {},
  onError = () => {},
  initialFiles = []
}) {
  const state = {
    files: [...initialFiles]
  };

  const root = el('div', { className: 'form-stack' });
  const errorBox = el('div', { className: 'alert-banner alert-banner--error', hidden: true, role: 'alert' });
  const listEl = el('ul', { className: 'file-list' });

  const fileInput = el('input', {
    type: 'file',
    id,
    accept,
    multiple,
    className: 'visually-hidden'
  });

  const chooseBtn = el(
    'button',
    {
      type: 'button',
      className: 'cta-button',
      onClick: () => fileInput.click()
    },
    svgIcon('upload', 18),
    multiple ? 'Dateien wählen' : 'Datei wählen'
  );

  const dropBox = el(
    'div',
    { className: 'dropzone' },
    el('div', { className: 'dropzone-icon' }, svgIcon('upload', 34)),
    el('label', { htmlFor: id, className: 'dropzone-label' }, label),
    chooseBtn,
    el('p', { className: 'dropzone-hint' }, hint),
    fileInput
  );

  function showErr(msg) {
    errorBox.textContent = msg;
    errorBox.hidden = false;
    onError(msg);
  }

  function clearErr() {
    errorBox.textContent = '';
    errorBox.hidden = true;
  }

  function renderList() {
    clear(listEl);
    state.files.forEach((item, idx) => {
      const actions = el('div', { className: 'file-item-actions' });
      if (multiple && state.files.length > 1) {
        actions.appendChild(
          el(
            'button',
            {
              type: 'button',
              className: 'icon-btn',
              disabled: idx === 0,
              'aria-label': `${item.name} nach oben`,
              onClick: () => {
                const copy = [...state.files];
                [copy[idx - 1], copy[idx]] = [copy[idx], copy[idx - 1]];
                state.files = copy;
                renderList();
                onFilesChange(state.files);
              }
            },
            '‹'
          )
        );
        actions.appendChild(
          el(
            'button',
            {
              type: 'button',
              className: 'icon-btn',
              disabled: idx === state.files.length - 1,
              'aria-label': `${item.name} nach unten`,
              onClick: () => {
                const copy = [...state.files];
                [copy[idx + 1], copy[idx]] = [copy[idx], copy[idx + 1]];
                state.files = copy;
                renderList();
                onFilesChange(state.files);
              }
            },
            '›'
          )
        );
      }
      actions.appendChild(
        el(
          'button',
          {
            type: 'button',
            className: 'icon-btn',
            'aria-label': `${item.name} entfernen`,
            onClick: () => {
              state.files = state.files.filter((_, i) => i !== idx);
              clearErr();
              renderList();
              onFilesChange(state.files);
            }
          },
          '×'
        )
      );

      listEl.appendChild(
        el(
          'li',
          { className: 'file-item' },
          el(
            'div',
            { className: 'file-item-meta' },
            el('span', { className: 'file-item-name' }, item.name),
            el('span', { className: 'file-item-sub' }, `${formatBytes(item.bytes.byteLength)}${item.extra ? ` · ${item.extra}` : ''}`)
          ),
          actions
        )
      );
    });
  }

  async function ingestFiles(fileList) {
    clearErr();
    try {
      validateBatchFiles(fileList);
      const parsed = [];
      for (const file of fileList) {
        const cleanName = sanitizeDisplayText(file.name, 90) || 'datei';
        const raw = new Uint8Array(await file.arrayBuffer());
        if (kind === 'pdf') {
          const validBytes = validatePdfBytes(raw, cleanName);
          parsed.push({ name: cleanName, bytes: validBytes, type: 'application/pdf' });
        } else if (kind === 'image') {
          const info = validateImageBytes(raw, cleanName);
          parsed.push({ name: cleanName, bytes: info.bytes, format: info.format, extra: info.format.toUpperCase() });
        } else if (kind === 'text') {
          const text = validateTextBytes(raw, cleanName);
          parsed.push({ name: cleanName, bytes: raw, text });
        }
      }
      state.files = multiple ? [...state.files, ...parsed] : [parsed[0]];
      renderList();
      onFilesChange(state.files);
    } catch (err) {
      showErr(err instanceof Error ? err.message : 'Datei konnte nicht geladen werden.');
    }
  }

  fileInput.addEventListener('change', () => {
    if (fileInput.files && fileInput.files.length > 0) {
      ingestFiles(Array.from(fileInput.files));
      fileInput.value = '';
    }
  });

  dropBox.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropBox.classList.add('is-dragover');
  });
  dropBox.addEventListener('dragleave', () => {
    dropBox.classList.remove('is-dragover');
  });
  dropBox.addEventListener('drop', (e) => {
    e.preventDefault();
    dropBox.classList.remove('is-dragover');
    if (e.dataTransfer?.files?.length) {
      ingestFiles(Array.from(e.dataTransfer.files));
    }
  });

  renderList();
  root.append(dropBox, errorBox, listEl);

  return {
    element: root,
    getFiles: () => state.files,
    setFiles: (next) => {
      state.files = [...next];
      clearErr();
      renderList();
      onFilesChange(state.files);
    },
    setError: showErr,
    clearError: clearErr
  };
}
