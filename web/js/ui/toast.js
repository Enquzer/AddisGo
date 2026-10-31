import { icon } from './icons.js';
import { esc } from './format.js';

const root = () => document.getElementById('toast-root');
const tones = {
  success: { icon: 'check-circle', role: 'status' },
  error: { icon: 'info', role: 'alert' },
  info: { icon: 'info', role: 'status' },
  warning: { icon: 'info', role: 'alert' },
};

export function toast(message, { type = 'success', duration = 4200 } = {}) {
  const container = root();
  if (!container) return () => {};
  const tone = tones[type] || tones.info;
  const node = document.createElement('div');
  node.className = `toast toast-${type}`;
  node.setAttribute('role', tone.role);
  node.innerHTML = `
    <span class="toast-icon">${icon(tone.icon, 18)}</span>
    <span class="toast-text">${esc(message)}</span>
    <button type="button" class="toast-close" aria-label="Dismiss notification">${icon('close', 16)}</button>
  `;
  const remove = () => {
    node.classList.add('is-leaving');
    window.setTimeout(() => node.remove(), 220);
  };
  node.querySelector('.toast-close')?.addEventListener('click', remove);
  container.append(node);
  const timer = window.setTimeout(remove, Math.max(1500, duration));
  node.addEventListener('mouseenter', () => window.clearTimeout(timer), { once: true });
  return remove;
}

export function toastError(error, fallback = 'Something went wrong. Please try again.') {
  toast(error?.message || fallback, { type: 'error', duration: 5600 });
}
