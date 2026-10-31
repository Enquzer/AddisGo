import { boot, state, subscribe, setUser } from './store.js';
import { renderShell } from './ui/layout.js';
import { start, render, navigate } from './router.js';
import { toast } from './ui/toast.js';
import { icon } from './ui/icons.js';

let shellCleanup = null;
let mounted = false;

function mountShell() {
  if (shellCleanup) {
    try { shellCleanup(); } catch { /* ignore */ }
  }
  shellCleanup = renderShell();
  mounted = true;
}

function setNetworkState() {
  const offline = !navigator.onLine;
  document.body.classList.toggle('is-offline', offline);
  let banner = document.getElementById('net-banner');
  if (offline) {
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'net-banner';
      banner.className = 'net-banner';
      banner.setAttribute('role', 'status');
      banner.innerHTML = `${icon('info', 15)} You are offline. AddisGo will reconnect when you are back.`;
      document.body.append(banner);
    }
  } else if (banner) {
    banner.remove();
  }
}

function initCookieBanner() {
  if (localStorage.getItem('addisgo_cookie_consent')) return;
  if (document.getElementById('cookie-consent-banner')) return;

  const banner = document.createElement('div');
  banner.id = 'cookie-consent-banner';
  banner.className = 'cookie-consent-banner';
  banner.setAttribute('role', 'region');
  banner.setAttribute('aria-label', 'Cookie and Data Privacy Consent');

  banner.innerHTML = `
    <div class="cookie-banner-inner">
      <div class="cookie-banner-copy">
        <span class="cookie-shield-icon">${icon('shield', 18)}</span>
        <div class="cookie-text-col">
          <strong>Your Privacy &amp; International Cookie Rights</strong>
          <p>
            AddisGo uses essential cookies for secure login and functional storage for favourite local landmarks. We never sell your personal data. Read our <a href="#/privacy" class="banner-link">Privacy Policy</a> and <a href="#/cookies" class="banner-link">Cookie Rights</a>.
          </p>
        </div>
      </div>
      <div class="cookie-banner-actions">
        <button type="button" class="btn btn-sm btn-ghost" id="btn-cookie-minimal">Essential Only</button>
        <a href="#/cookies" class="btn btn-sm btn-ghost" id="btn-cookie-custom">Preferences</a>
        <button type="button" class="btn btn-sm btn-cyan" id="btn-cookie-accept">Accept All</button>
      </div>
    </div>
  `;

  document.body.appendChild(banner);

  banner.querySelector('#btn-cookie-accept')?.addEventListener('click', () => {
    localStorage.setItem('addisgo_cookie_consent', 'all');
    localStorage.setItem('addisgo_cookie_consent_time', new Date().toISOString());
    banner.remove();
  });

  banner.querySelector('#btn-cookie-minimal')?.addEventListener('click', () => {
    localStorage.setItem('addisgo_cookie_consent', 'minimal');
    localStorage.setItem('addisgo_cookie_consent_time', new Date().toISOString());
    banner.remove();
  });

  banner.querySelector('#btn-cookie-custom')?.addEventListener('click', () => {
    banner.remove();
  });
}

async function init() {
  await boot();
  mountShell();
  start();
  initCookieBanner();

  subscribe(() => {
    mountShell();
    // Re-render the current route with the new session on the next tick.
    window.setTimeout(() => {
      void render();
    }, 0);
  });

  window.addEventListener('auth:expired', () => {
    if (!state.user) return;
    setUser(null);
    toast('Your session expired. Please sign in again.', { type: 'warning' });
    const next = encodeURIComponent(window.location.hash.replace(/^#/, '') || '/');
    navigate(`/login?next=${next}`, { replace: true });
  });

  window.addEventListener('online', () => {
    setNetworkState();
    toast('Back online.', { type: 'info' });
  });
  window.addEventListener('offline', () => {
    setNetworkState();
    toast('You are offline. Some actions will wait until you reconnect.', { type: 'warning', duration: 6000 });
  });
  setNetworkState();

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    if (reason?.name === 'AbortError') return;
    console.error('Unhandled rejection', reason);
  });
  window.addEventListener('error', (event) => {
    if (event?.message) console.error('Window error', event.message);
  });

  // Reflect session changes made in other tabs.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden || !mounted) return;
    if (state.ready) {
      /* notifications and pages refresh themselves */
    }
  });
}

init().catch((error) => {
  console.error('AddisGo failed to start', error);
  const app = document.getElementById('app');
  if (app) {
    app.innerHTML = `<div class="fatal">
      <h1>AddisGo could not start</h1>
      <p>Refresh the page. If this keeps happening, the server may be offline.</p>
      <a class="btn btn-primary" href="/">Reload AddisGo</a>
    </div>`;
  }
});
