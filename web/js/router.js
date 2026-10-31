import { state } from './store.js';
import { setActiveNav, errorBlock } from './ui/layout.js';
import { scrollToTop } from './ui/dom.js';
import { toast } from './ui/toast.js';
import { icon } from './ui/icons.js';

const routes = [
  { path: '/', load: () => import('./pages/home.js'), title: 'AddisGo', context: 'Move through Addis like a local' },
  { path: '/dashboard', load: () => import('./pages/home.js'), title: 'My Dashboard', auth: true },
  { path: '/welcome', load: () => import('./pages/welcome.js'), title: 'Why AddisGo · Electric City Rides' },
  { path: '/login', load: () => import('./pages/auth.js'), title: 'Sign in', guestOnly: true },
  { path: '/register', load: () => import('./pages/auth.js'), title: 'Create account', guestOnly: true },
  { path: '/ride', load: () => import('./pages/ride.js'), title: 'Book a ride', auth: true },
  { path: '/ride/:id', load: () => import('./pages/ride.js'), title: 'Your ride', auth: true },
  { path: '/trips', load: () => import('./pages/trips.js'), title: 'Trips & receipts', auth: true },
  { path: '/tours', load: () => import('./pages/tours.js'), title: 'City tours' },
  { path: '/tour/:id', load: () => import('./pages/tour.js'), title: 'Tour details' },
  { path: '/driver', load: () => import('./pages/driver.js'), title: 'Driver dashboard', roles: ['driver'] },
  { path: '/profile', load: () => import('./pages/profile.js'), title: 'Profile & safety', auth: true },
  { path: '/admin', load: () => import('./pages/admin.js'), title: 'Operations CRM', roles: ['admin'] },
  { path: '/terms', load: () => import('./pages/legal.js'), title: 'Terms & Conditions' },
  { path: '/privacy', load: () => import('./pages/legal.js'), title: 'Privacy Policy (GDPR/CCPA)' },
  { path: '/cookies', load: () => import('./pages/legal.js'), title: 'Cookie Rights & Policy' },
  { path: '/legal', load: () => import('./pages/legal.js'), title: 'Legal Disclaimers & Safety' },
];

let activeCleanup = null;
let currentKey = '';
let started = false;

function parseHash() {
  const raw = window.location.hash.replace(/^#/, '') || '/';
  const [pathPart, queryPart = ''] = raw.split('?');
  const path = pathPart.startsWith('/') ? pathPart : `/${pathPart}`;
  const query = new URLSearchParams(queryPart);
  return { path: normalize(path), query, raw };
}

function normalize(path) {
  if (path.length > 1 && path.endsWith('/')) return path.slice(0, -1);
  return path;
}

function matchRoute(path) {
  for (const route of routes) {
    const routeParts = route.path.split('/').filter(Boolean);
    const pathParts = path.split('/').filter(Boolean);
    if (routeParts.length !== pathParts.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < routeParts.length; i += 1) {
      const rp = routeParts[i];
      const pp = pathParts[i];
      if (rp.startsWith(':')) params[rp.slice(1)] = decodeURIComponent(pp);
      else if (rp !== pp) { ok = false; break; }
    }
    if (ok) return { route, params };
  }
  return null;
}

export function navigate(path, { replace = false, query = null } = {}) {
  let target = path.startsWith('#') ? path.slice(1) : path;
  if (query) {
    const params = query instanceof URLSearchParams ? query : new URLSearchParams(query);
    const qs = params.toString();
    if (qs) target += `${target.includes('?') ? '&' : '?'}${qs}`;
  }
  const hash = `#${target.startsWith('/') ? target : `/${target}`}`;
  if (replace) {
    window.history.replaceState(null, '', hash);
    void render();
  } else if (window.location.hash === hash) {
    void render();
  } else {
    window.location.hash = hash;
  }
}

export async function render() {
  const { path, query, raw } = parseHash();
  const found = matchRoute(path);
  const view = document.getElementById('view');
  if (!view) return;

  if (activeCleanup) {
    try { activeCleanup(); } catch { /* ignore */ }
    activeCleanup = null;
  }

  if (!found) {
    document.title = 'Page not found · AddisGo';
    setActiveNav('#/');
    view.innerHTML = `<div class="not-found">
      <p class="eyebrow">404</p>
      <h1>That street doesn't exist.</h1>
      <p>The page you were looking for has moved or never made it onto the map.</p>
      <a class="btn btn-primary" href="#/">${icon('home', 16)} Back to AddisGo</a>
    </div>`;
    return;
  }

  const { route, params } = found;

  if (route.auth && !state.user) {
    const next = encodeURIComponent(raw);
    toast('Sign in to continue.', { type: 'info' });
    navigate(`/login?next=${next}`, { replace: true });
    return;
  }
  if (route.guestOnly && state.user) {
    navigate('/', { replace: true });
    return;
  }
  if (route.roles && (!state.user || !route.roles.includes(state.user.role))) {
    toast('That area is restricted.', { type: 'warning' });
    navigate('/', { replace: true });
    return;
  }

  const key = `${raw}|${state.user?.id || 0}|${state.user?.role || 'guest'}`;
  currentKey = key;
  document.title = `${route.title || 'AddisGo'} · AddisGo`;
  setActiveNav(`#${raw}`);
  view.innerHTML = `<div class="route-loading" aria-hidden="true">
    <div class="spinner"></div>
    <p>Loading your Addis…</p>
  </div>`;

  try {
    const module = await route.load();
    const page = module.default;
    if (typeof page !== 'function') throw new Error('Page module is missing a render function');
    const cleanup = await page(view, {
      params,
      query,
      navigate,
      route,
      raw,
      user: state.user,
    });
    activeCleanup = typeof cleanup === 'function' ? cleanup : null;
    scrollToTop('instant');
    try { view.focus({ preventScroll: true }); } catch { /* ignore */ }
  } catch (error) {
    console.error('Page failed to load', error);
    view.innerHTML = errorBlock('This page could not be loaded. Please check your connection and try again.');
    view.querySelector('#retry-block')?.addEventListener('click', () => void render());
  }
}

export function reload() {
  currentKey = '';
  return render();
}

export function start() {
  if (started) return;
  started = true;
  window.addEventListener('hashchange', () => void render());
  void render();
}
