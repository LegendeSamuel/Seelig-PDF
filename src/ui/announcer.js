export function announcePolite(message) {
  const el = document.getElementById('live-polite');
  if (!el) return;
  el.textContent = '';
  requestAnimationFrame(() => {
    el.textContent = String(message || '');
  });
}

export function announceAlert(message) {
  const el = document.getElementById('live-alert');
  if (!el) return;
  el.textContent = '';
  requestAnimationFrame(() => {
    el.textContent = String(message || '');
  });
}
