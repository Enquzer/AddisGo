/* Tiny DOM helpers. Everything user-authored is escaped before it reaches innerHTML. */

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

export function classes(...parts) {
  return parts.flat().filter(Boolean).join(' ');
}

export function on(root, selector, eventName, handler, options) {
  if (!root) return () => {};
  const listener = (event) => {
    const target = event.target instanceof Element ? event.target.closest(selector) : null;
    if (target && root.contains(target)) handler(event, target);
  };
  root.addEventListener(eventName, listener, options);
  return () => root.removeEventListener(eventName, listener, options);
}

export function setHTML(root, content) {
  if (root) root.innerHTML = content;
}

export function formValues(form) {
  const data = new FormData(form);
  const out = {};
  for (const [key, value] of data.entries()) {
    if (key in out) {
      out[key] = Array.isArray(out[key]) ? [...out[key], value] : [out[key], value];
    } else {
      out[key] = value;
    }
  }
  return out;
}

export function focusFirst(root) {
  const target = root?.querySelector(
    'input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])',
  );
  if (target) {
    try {
      target.focus({ preventScroll: true });
    } catch {
      target.focus();
    }
  }
}

export function scrollToTop(behavior = 'smooth') {
  try {
    window.scrollTo({ top: 0, behavior });
  } catch {
    window.scrollTo(0, 0);
  }
}

export function escapeAttr(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

/** A loading button helper: disables + shows a spinner while an async task runs. */
export async function withBusy(button, task) {
  if (!button) return task();
  const original = button.innerHTML;
  button.disabled = true;
  button.classList.add('is-busy');
  button.innerHTML = '<span class="spinner spinner-sm" aria-hidden="true"></span><span>Working…</span>';
  try {
    return await task();
  } finally {
    button.disabled = false;
    button.classList.remove('is-busy');
    button.innerHTML = original;
  }
}
