import { clear, el, svgIcon } from '../ui/dom.js';
import { createResultPanel } from '../ui/result-panel.js';
import { abortActivePdfWork } from '../engine/worker-client.js';
import { announceAlert, announcePolite } from '../ui/announcer.js';

export function buildToolShell({
  tool,
  onBack,
  onChainToTool
}) {
  const root = el('section', { className: 'workspace', 'aria-labelledby': 'tool-heading' });

  const topbar = el(
    'div',
    { className: 'workspace-topbar' },
    el(
      'button',
      {
        type: 'button',
        className: 'back-btn',
        onClick: onBack
      },
      '← Alle Werkzeuge'
    ),
    el('span', { className: 'eyebrow' }, tool.categoryLabel)
  );

  const header = el(
    'header',
    { className: 'workspace-header' },
    el('h1', { id: 'tool-heading', tabindex: '-1' }, tool.name),
    el('p', { className: 'muted-copy' }, tool.description)
  );

  const leftPanel = el('div', { className: 'panel-card' });
  const rightPanel = el('div', { className: 'panel-card' });
  const grid = el('div', { className: 'workspace-grid' }, leftPanel, rightPanel);

  const errorBanner = el('div', { className: 'alert-banner alert-banner--error', hidden: true, role: 'alert' });
  const progressBar = el('progress', { max: 100, value: 0 });
  const progressLabel = el('span', { className: 'muted-copy' }, 'Verarbeitung läuft …');
  const cancelBtn = el(
    'button',
    {
      type: 'button',
      className: 'cta-button cta-button--ghost',
      onClick: () => abortActivePdfWork()
    },
    'Abbrechen'
  );
  const progressBox = el(
    'div',
    { className: 'progress-box', hidden: true },
    progressLabel,
    progressBar,
    cancelBtn
  );

  const resultPanel = createResultPanel({ onChainToTool });

  root.append(topbar, header, grid, errorBanner, progressBox, resultPanel.element);

  function setError(message) {
    if (!message) {
      errorBanner.hidden = true;
      errorBanner.textContent = '';
      return;
    }
    errorBanner.textContent = message;
    errorBanner.hidden = false;
    announceAlert(message);
  }

  function setProgress(active, pct = 0, label = 'Verarbeitung läuft …') {
    progressBox.hidden = !active;
    if (active) {
      if (pct === null) {
        progressBar.removeAttribute('value');
      } else {
        progressBar.value = Math.max(0, Math.min(100, Math.round(pct * 100)));
      }
      progressLabel.textContent = label;
    }
  }

  async function runTask(actionBtn, label, taskFn) {
    setError('');
    resultPanel.hide();
    if (actionBtn) actionBtn.disabled = true;
    setProgress(true, null, label);
    announcePolite(label);
    try {
      await taskFn({ setProgress: (frac, msg) => setProgress(true, frac, msg) });
      announcePolite('Verarbeitung abgeschlossen.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verarbeitung fehlgeschlagen.');
    } finally {
      setProgress(false);
      if (actionBtn) actionBtn.disabled = false;
    }
  }

  return {
    root,
    leftPanel,
    rightPanel,
    grid,
    resultPanel,
    setError,
    setProgress,
    runTask
  };
}

export function makeLabeledField(id, labelText, controlEl, hintText = '') {
  const wrap = el('div', { className: 'form-group' });
  const label = el('label', { htmlFor: id }, labelText);
  wrap.append(label, controlEl);
  if (hintText) {
    const hintId = `${id}-hint`;
    controlEl.setAttribute('aria-describedby', hintId);
    wrap.appendChild(el('span', { id: hintId, className: 'form-hint' }, hintText));
  }
  return wrap;
}

export function makeRadioGroup(legendText, name, options, initialValue, onChange) {
  const fieldset = el('fieldset', { className: 'radio-fieldset' }, el('legend', {}, legendText));
  options.forEach((opt, idx) => {
    const id = `${name}-${idx}`;
    const input = el('input', {
      type: 'radio',
      id,
      name,
      value: opt.value,
      checked: opt.value === initialValue,
      onChange: () => onChange(opt.value)
    });
    const row = el('label', { htmlFor: id, className: 'choice-row' }, input, opt.label);
    fieldset.appendChild(row);
  });
  return fieldset;
}

export function makePasswordField(id, labelText, { autocomplete = 'new-password', hint = '' } = {}) {
  const input = el('input', {
    type: 'password',
    id,
    autocomplete,
    autocorrect: 'off',
    autocapitalize: 'none',
    spellcheck: 'false'
  });

  const toggleBtn = el(
    'button',
    {
      type: 'button',
      className: 'cta-button cta-button--ghost',
      'aria-pressed': 'false',
      'aria-label': `${labelText} anzeigen`,
      onClick: () => {
        const show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        toggleBtn.setAttribute('aria-pressed', String(show));
        toggleBtn.textContent = show ? 'Verbergen' : 'Anzeigen';
      }
    },
    'Anzeigen'
  );

  const row = el('div', { className: 'password-row' }, input, toggleBtn);
  const wrap = el('div', { className: 'form-group' }, el('label', { htmlFor: id }, labelText), row);
  if (hint) {
    const hintId = `${id}-hint`;
    input.setAttribute('aria-describedby', hintId);
    wrap.appendChild(el('span', { id: hintId, className: 'form-hint' }, hint));
  }
  return { wrap, input };
}

export function makePrimaryButton(label, onClick) {
  return el(
    'button',
    {
      type: 'button',
      className: 'cta-button cta-button--filled',
      onClick
    },
    svgIcon('sparkle', 18),
    label
  );
}

export function attachClearOnInput(input) {
  input.addEventListener('input', () => {
    input.removeAttribute('aria-invalid');
    input.setCustomValidity('');
  });
}

export function replacePreview(container, node) {
  clear(container);
  container.appendChild(node);
}
