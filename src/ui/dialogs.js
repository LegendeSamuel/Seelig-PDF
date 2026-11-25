export function wireDialogHelpers() {
  const dialogs = Array.from(document.querySelectorAll('dialog'));
  for (const dialog of dialogs) {
    dialog.addEventListener('close', () => {
      dialog.returnValue = '';
    });
  }

  // Fallback for browsers lacking Invoker Commands (`command="show-modal"` / `"close"`)
  if (!('commandForElement' in HTMLButtonElement.prototype)) {
    document.querySelectorAll('button[command][commandfor]').forEach((btn) => {
      const targetId = btn.getAttribute('commandfor');
      const cmd = btn.getAttribute('command');
      btn.addEventListener('click', () => {
        const dlg = targetId ? document.getElementById(targetId) : null;
        if (!dlg || typeof dlg.showModal !== 'function') return;
        if (cmd === 'show-modal' && !dlg.open) dlg.showModal();
        else if (cmd === 'close' && dlg.open) dlg.close();
      });
    });
  }

  // Fallback for browsers lacking `<dialog closedby="any">` (e.g., Safari)
  if (typeof HTMLDialogElement !== 'undefined' && !('closedBy' in HTMLDialogElement.prototype)) {
    const outside = (e, dialog) => {
      const r = dialog.getBoundingClientRect();
      return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
    };
    for (const dialog of document.querySelectorAll('dialog[closedby="any"]')) {
      let pressedOutside = false;
      dialog.addEventListener('pointerdown', (e) => {
        pressedOutside = outside(e, dialog);
      });
      dialog.addEventListener('pointerup', (e) => {
        if (pressedOutside && outside(e, dialog) && dialog.open) {
          dialog.close();
        }
      });
    }
  }
}
