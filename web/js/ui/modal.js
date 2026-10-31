import { icon } from './icons.js';
import { esc } from './format.js';
import { focusFirst } from './dom.js';

const root = () => document.getElementById('modal-root');
let openCount = 0;

export function openModal({
  title = '',
  eyebrow = '',
  body = '',
  footer = '',
  size = 'md',
  onClose = null,
  closeLabel = 'Close dialog',
  initialFocus = true,
} = {}) {
  const container = root();
  if (!container) return { close() {}, element: null };

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-panel modal-${size}" role="dialog" aria-modal="true" aria-labelledby="modal-title-${Date.now()}">
      <header class="modal-head">
        <div>
          ${eyebrow ? `<p class="modal-eyebrow">${esc(eyebrow)}</p>` : ''}
          <h2 id="modal-title-${Date.now()}" class="modal-title">${esc(title)}</h2>
        </div>
        <button type="button" class="icon-btn modal-close" aria-label="${esc(closeLabel)}">${icon('close', 20)}</button>
      </header>
      <div class="modal-body">${body}</div>
      ${footer ? `<footer class="modal-foot">${footer}</footer>` : ''}
    </div>
  `;

  const previousActive = document.activeElement;
  let closed = false;

  const close = () => {
    if (closed) return;
    closed = true;
    overlay.classList.add('is-closing');
    document.removeEventListener('keydown', onKeyDown, true);
    window.setTimeout(() => {
      overlay.remove();
      openCount = Math.max(0, openCount - 1);
      if (openCount === 0) document.body.classList.remove('modal-open');
    }, 180);
    if (typeof onClose === 'function') onClose();
    if (previousActive instanceof HTMLElement && document.contains(previousActive)) {
      previousActive.focus({ preventScroll: true });
    }
  };

  const onKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusables = Array.from(
      overlay.querySelectorAll('button, [href], input:not([type="hidden"]), select, textarea, [tabindex]:not([tabindex="-1"])'),
    ).filter((el) => !el.disabled && el.offsetParent !== null);
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) close();
  });
  overlay.querySelector('.modal-close')?.addEventListener('click', close);
  document.addEventListener('keydown', onKeyDown, true);
  container.append(overlay);
  openCount += 1;
  document.body.classList.add('modal-open');
  requestAnimationFrame(() => overlay.classList.add('is-open'));
  if (initialFocus) {
    window.setTimeout(() => focusFirst(overlay.querySelector('.modal-body') || overlay), 60);
  }

  return {
    element: overlay,
    body: overlay.querySelector('.modal-body'),
    footer: overlay.querySelector('.modal-foot'),
    close,
    setBusy(isBusy) {
      overlay.classList.toggle('is-busy', Boolean(isBusy));
    },
  };
}

export function confirmModal({
  title = 'Are you sure?',
  message = '',
  confirmLabel = 'Confirm',
  cancelLabel = 'Keep it',
  danger = false,
  eyebrow = '',
} = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const modal = openModal({
      title,
      eyebrow,
      size: 'sm',
      body: `<p class="modal-text">${esc(message)}</p>`,
      footer: `
        <button type="button" class="btn btn-ghost" data-act="cancel">${esc(cancelLabel)}</button>
        <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-act="confirm">${esc(confirmLabel)}</button>
      `,
      onClose: () => {
        if (!settled) {
          settled = true;
          resolve(false);
        }
      },
    });
    modal.footer?.querySelector('[data-act="cancel"]')?.addEventListener('click', () => modal.close());
    modal.footer?.querySelector('[data-act="confirm"]')?.addEventListener('click', () => {
      settled = true;
      modal.close();
      resolve(true);
    });
  });
}

export function promptModal({
  title,
  eyebrow = '',
  label,
  placeholder = '',
  value = '',
  confirmLabel = 'Save',
  multiline = false,
  maxLength = 300,
  hint = '',
} = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const field = multiline
      ? `<textarea class="field-input" name="value" rows="3" maxlength="${maxLength}" placeholder="${esc(placeholder)}">${esc(value)}</textarea>`
      : `<input class="field-input" name="value" type="text" maxlength="${maxLength}" placeholder="${esc(placeholder)}" value="${esc(value)}" />`;
    const modal = openModal({
      title,
      eyebrow,
      size: 'sm',
      body: `
        <form class="form" data-prompt-form>
          <label class="field">
            <span class="field-label">${esc(label)}</span>
            ${field}
            ${hint ? `<span class="field-hint">${esc(hint)}</span>` : ''}
          </label>
        </form>
      `,
      footer: `
        <button type="button" class="btn btn-ghost" data-act="cancel">Cancel</button>
        <button type="submit" class="btn btn-primary" form="" data-act="save">${esc(confirmLabel)}</button>
      `,
      onClose: () => {
        if (!settled) {
          settled = true;
          resolve(null);
        }
      },
    });
    const form = modal.body.querySelector('[data-prompt-form]');
    const input = form.querySelector('[name="value"]');
    const submit = () => {
      const text = input.value.trim();
      if (!text) {
        input.classList.add('is-invalid');
        input.focus();
        return;
      }
      settled = true;
      modal.close();
      resolve(text);
    };
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      submit();
    });
    modal.footer.querySelector('[data-act="save"]').addEventListener('click', submit);
    modal.footer.querySelector('[data-act="cancel"]').addEventListener('click', () => modal.close());
  });
}
