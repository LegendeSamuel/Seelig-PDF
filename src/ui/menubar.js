export function wireAppMenubar({
  onAction = () => {},
  onToolSelect = () => {}
} = {}) {
  const menubar = document.querySelector('[role="menubar"]');
  if (!menubar) return { syncState: () => {} };

  const rootTriggers = [...menubar.querySelectorAll(':scope > [commandfor]')];
  const enterOnOpen = new WeakSet();
  let pointerTrigger = null;
  let ignorePreviewForTrigger = null;
  let ignoreNextFocus = false;

  const menuFor = (trigger) => {
    const id = trigger?.getAttribute('commandfor');
    return id ? document.getElementById(id) : null;
  };

  const triggerFor = (menu) =>
    rootTriggers.find((t) => t.getAttribute('commandfor') === menu.id) || null;

  const isOpen = (menu) =>
    Boolean(menu && (menu.matches(':popover-open') || menu.classList.contains(':popover-open')));

  const getEnabledItems = (groupEl) =>
    [...groupEl.querySelectorAll('button, a')]
      .filter((item) => item.closest('[focusgroup]') === groupEl)
      .filter((item) => !item.disabled && item.getAttribute('aria-disabled') !== 'true');

  function closeAllMenus({ restoreFocusTo = null } = {}) {
    rootTriggers.forEach((t) => {
      const m = menuFor(t);
      if (isOpen(m)) {
        try {
          m.hidePopover();
        } catch {
          m.classList.remove(':popover-open');
          t.setAttribute('aria-expanded', 'false');
        }
      }
    });
    if (restoreFocusTo) {
      ignorePreviewForTrigger = restoreFocusTo;
      restoreFocusTo.focus({ preventScroll: true });
      setTimeout(() => {
        if (ignorePreviewForTrigger === restoreFocusTo) ignorePreviewForTrigger = null;
      }, 0);
    }
  }

  function positionMenuFallback(menu, trigger) {
    if (typeof CSS !== 'undefined' && CSS.supports?.('position-area: block-end')) return;
    if (!trigger) return;
    const tRect = trigger.getBoundingClientRect();
    const mRect = menu.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = Math.min(tRect.left, Math.max(8, vw - mRect.width - 8));
    let top = tRect.bottom + 2;
    if (top + mRect.height > vh - 8) {
      top = Math.max(8, tRect.top - mRect.height - 2);
    }
    menu.style.left = `${Math.max(8, Math.round(left))}px`;
    menu.style.top = `${Math.round(top)}px`;
  }

  function moveToRootTrigger(fromTrigger, direction, { preview = true } = {}) {
    const idx = rootTriggers.indexOf(fromTrigger);
    if (idx === -1) return;
    const next = rootTriggers[(idx + direction + rootTriggers.length) % rootTriggers.length];
    rootTriggers.forEach((t) => {
      t.tabIndex = t === next ? 0 : -1;
    });
    rootTriggers.map(menuFor).filter(isOpen).forEach((m) => {
      try {
        m.hidePopover();
      } catch {
        // ignore
      }
    });
    if (!preview) ignorePreviewForTrigger = next;
    next.focus({ preventScroll: true });
  }

  function openMenuFromKeyboard(trigger, index = 0) {
    const menu = menuFor(trigger);
    if (!menu) return;
    const groupEl = menu.querySelector('[focusgroup~="menu"]');
    if (!groupEl) return;
    const focusTarget = () => {
      const items = getEnabledItems(groupEl);
      if (!items.length) return;
      const target = index === -1 ? items[items.length - 1] : items[Math.min(index, items.length - 1)];
      target?.focus({ preventScroll: true });
    };
    if (isOpen(menu)) {
      focusTarget();
      return;
    }
    enterOnOpen.add(menu);
    menu.dataset.enterIndex = String(index);
    trigger.click();
  }

  // Fallback for browsers without native commandfor="toggle-popover"
  if (typeof HTMLButtonElement !== 'undefined' && !('commandForElement' in HTMLButtonElement.prototype)) {
    rootTriggers.forEach((trigger) => {
      trigger.addEventListener('click', () => {
        const menu = menuFor(trigger);
        if (!menu) return;
        if (isOpen(menu)) menu.hidePopover?.();
        else menu.showPopover?.({ source: trigger });
      });
    });
  }

  // Fallback for browsers without native focusgroup="menu"
  if (typeof HTMLElement !== 'undefined' && !('focusGroup' in HTMLElement.prototype)) {
    menubar.querySelectorAll('[focusgroup~="menu"]').forEach((group) => {
      group.setAttribute('role', 'menu');
      group.querySelectorAll('button:not([role]), a:not([role])').forEach((item) => {
        item.setAttribute('role', 'menuitem');
      });
      group.addEventListener(
        'keydown',
        (event) => {
          if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
          const items = getEnabledItems(group);
          const current = items.indexOf(document.activeElement);
          if (current < 0) return;
          const next =
            event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? items.length - 1
                : (current + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length;
          event.preventDefault();
          event.stopImmediatePropagation();
          items[next].focus({ preventScroll: true });
        },
        true
      );
    });
  }

  window.addEventListener('blur', () => {
    ignoreNextFocus = true;
  });
  window.addEventListener('focus', () => {
    setTimeout(() => {
      ignoreNextFocus = false;
    }, 0);
  });

  rootTriggers.forEach((trigger) => {
    const menu = menuFor(trigger);
    if (!menu) return;
    const groupEl = menu.querySelector('[focusgroup~="menu"]');

    trigger.addEventListener('pointerdown', (e) => {
      pointerTrigger = trigger;
      // Prevent focus-before-click from double-toggling the popover
      e.preventDefault();
    });

    trigger.addEventListener('pointerenter', () => {
      const anyOpen = rootTriggers.map(menuFor).some((m) => m !== menu && isOpen(m));
      if (!anyOpen) return;
      rootTriggers.forEach((t) => {
        t.tabIndex = t === trigger ? 0 : -1;
      });
      rootTriggers.map(menuFor).filter(isOpen).forEach((m) => m.hidePopover());
      trigger.focus({ preventScroll: true });
    });

    trigger.addEventListener('focus', () => {
      if (ignoreNextFocus || ignorePreviewForTrigger === trigger) return;
      if (isOpen(menu)) return;
      try {
        menu.showPopover({ source: trigger });
      } catch {
        menu.showPopover?.();
      }
    });

    trigger.addEventListener('blur', (e) => {
      const dest = e.relatedTarget;
      if (dest && menu.contains(dest)) return;
      if (isOpen(menu) && !menubar.contains(dest)) {
        menu.hidePopover();
      }
    });

    trigger.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        moveToRootTrigger(trigger, 1, { preview: true });
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        moveToRootTrigger(trigger, -1, { preview: true });
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        openMenuFromKeyboard(trigger, 0);
      } else if (e.key === 'Home') {
        e.preventDefault();
        openMenuFromKeyboard(trigger, 0);
      } else if (e.key === 'End') {
        e.preventDefault();
        openMenuFromKeyboard(trigger, -1);
      } else if (e.key === 'Tab') {
        closeAllMenus();
      } else if (e.key === 'Escape' && isOpen(menu)) {
        e.preventDefault();
        menu.hidePopover();
      }
    });

    menu.addEventListener('toggle', (e) => {
      const opened = e.newState === 'open';
      trigger.setAttribute('aria-expanded', String(opened));
      if (!opened) {
        pointerTrigger = null;
        return;
      }

      rootTriggers.forEach((t) => {
        const other = menuFor(t);
        if (other && other !== menu && isOpen(other)) other.hidePopover();
      });

      positionMenuFallback(menu, trigger);

      if (enterOnOpen.has(menu)) {
        enterOnOpen.delete(menu);
        const idx = Number(menu.dataset.enterIndex || 0);
        const items = groupEl ? getEnabledItems(groupEl) : [];
        const target = idx === -1 ? items[items.length - 1] : items[Math.min(idx, items.length - 1)];
        target?.focus({ preventScroll: true });
      } else if (pointerTrigger === trigger) {
        ignorePreviewForTrigger = trigger;
        trigger.focus({ preventScroll: true });
        setTimeout(() => {
          if (ignorePreviewForTrigger === trigger) ignorePreviewForTrigger = null;
        }, 0);
      }
      pointerTrigger = null;
    });

    if (groupEl) {
      groupEl.addEventListener('pointermove', (e) => {
        const item = e.target.closest('button, a');
        if (!item || !groupEl.contains(item) || item.disabled || item.getAttribute('aria-disabled') === 'true') return;
        const underPointer = document.elementFromPoint(e.clientX, e.clientY);
        if (!underPointer || !item.contains(underPointer)) return;
        if (document.activeElement !== item) {
          item.focus({ preventScroll: true });
        }
      });

      groupEl.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowRight') {
          e.preventDefault();
          moveToRootTrigger(trigger, 1, { preview: true });
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault();
          moveToRootTrigger(trigger, -1, { preview: true });
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          closeAllMenus({ restoreFocusTo: trigger });
        } else if (e.key === 'Tab') {
          closeAllMenus();
        } else if (e.key === 'Home' || e.key === 'End') {
          const items = getEnabledItems(groupEl);
          if (!items.length) return;
          e.preventDefault();
          (e.key === 'Home' ? items[0] : items[items.length - 1]).focus({ preventScroll: true });
        }
      });

      groupEl.addEventListener('click', (e) => {
        const btn = e.target.closest('button');
        const link = e.target.closest('a[href]');
        if (link && groupEl.contains(link)) {
          setTimeout(() => closeAllMenus(), 0);
          return;
        }
        if (!btn || !groupEl.contains(btn)) return;
        if (btn.disabled || btn.getAttribute('aria-disabled') === 'true') {
          e.preventDefault();
          return;
        }

        const action = btn.dataset.menuAction;
        const toolId = btn.dataset.menuTool;
        if (action) onAction(action);
        else if (toolId) onToolSelect(toolId);

        const role = btn.getAttribute('role');
        if (role === 'menuitemcheckbox' || role === 'menuitemradio') {
          setTimeout(() => closeAllMenus(), 220);
        } else {
          closeAllMenus();
        }
      });
    }
  });

  document.addEventListener('focusin', (e) => {
    if (!menubar.contains(e.target)) {
      closeAllMenus();
    }
  });

  function syncState({
    hasActivePdf = false,
    isReaderRoute = false,
    viewMode = 'single',
    readingMode = 'original',
    sidebarOpen = true,
    splitActive = false,
    fullscreen = false
  } = {}) {
    const docActions = new Set([
      'file-save',
      'file-save-as',
      'file-print',
      'file-close-tab',
      'view-search',
      'view-rotate',
      'view-split',
      'view-sidebar'
    ]);
    menubar.querySelectorAll('[data-menu-action]').forEach((btn) => {
      const action = btn.dataset.menuAction;
      if (docActions.has(action)) {
        const disabled = !hasActivePdf;
        btn.setAttribute('aria-disabled', disabled ? 'true' : 'false');
        if (disabled) btn.setAttribute('aria-disabled', 'true');
        else btn.removeAttribute('aria-disabled');
      }
      if (action === 'view-fullscreen') {
        btn.setAttribute('aria-checked', String(Boolean(fullscreen)));
      } else if (action === 'view-sidebar') {
        btn.setAttribute('aria-checked', String(Boolean(sidebarOpen)));
      } else if (action === 'view-split') {
        btn.setAttribute('aria-checked', String(Boolean(splitActive)));
      } else if (action.startsWith('view-mode-')) {
        const targetMode = action.replace('view-mode-', '');
        btn.setAttribute('aria-checked', String(viewMode === targetMode));
      } else if (action.startsWith('reading-mode-')) {
        const targetReading = action.replace('reading-mode-', '');
        btn.setAttribute('aria-checked', String(readingMode === targetReading));
      }
    });

    const viewOnly = new Set(['view-mode-single', 'view-mode-two-page', 'view-mode-book']);
    menubar.querySelectorAll('[data-menu-action]').forEach((btn) => {
      if (viewOnly.has(btn.dataset.menuAction) && !isReaderRoute && !hasActivePdf) {
        btn.setAttribute('aria-disabled', 'true');
      } else if (viewOnly.has(btn.dataset.menuAction)) {
        btn.removeAttribute('aria-disabled');
      }
    });
  }

  return { syncState, closeAllMenus };
}
