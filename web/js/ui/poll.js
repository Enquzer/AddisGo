/**
 * Polling helper for live-ish updates (SQLite backend, no websockets).
 * - runs immediately
 * - pauses while the tab is hidden
 * - serialises calls so slow responses never stack up
 * - stops cleanly when the page unmounts
 */
export function createPoller(task, intervalMs = 6000, { immediate = true } = {}) {
  let timer = null;
  let stopped = false;
  let running = false;
  let again = false;

  const tick = async () => {
    if (stopped || running) return;
    if (document.hidden && !again) return;
    running = true;
    try {
      await task();
    } catch {
      /* page-level handlers surface errors; polling should stay quiet */
    } finally {
      running = false;
      if (again) {
        again = false;
        if (!stopped) void tick();
      }
    }
  };

  const schedule = () => {
    if (stopped) return;
    window.clearInterval(timer);
    timer = window.setInterval(tick, Math.max(1500, intervalMs));
  };

  const onVisible = () => {
    if (!document.hidden) void tick();
  };

  document.addEventListener('visibilitychange', onVisible);
  schedule();
  if (immediate) void tick();

  return {
    kick() {
      if (stopped) return;
      if (running) {
        again = true;
        return;
      }
      void tick();
    },
    stop() {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    },
  };
}

/** Debounce that returns a promise-free callback and supports cancel. */
export function debounce(fn, wait = 280) {
  let timer = null;
  const wrapped = (...args) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), wait);
  };
  wrapped.cancel = () => window.clearTimeout(timer);
  return wrapped;
}
