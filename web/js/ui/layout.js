import { icon, logoMark } from './icons.js';
import { esc, avatar, roleLabel, greeting } from './format.js';
import { $, on } from './dom.js';
import { api } from '../api.js';
import { state, logout } from '../store.js';
import { toast, toastError } from './toast.js';
import { createPoller } from './poll.js';
import { mountGlobalOverlayChat } from './chat.js';

const NAV = {
  guest: [
    { href: '#/', icon: 'home', label: 'Home' },
    { href: '#/tours', icon: 'compass', label: 'City tours' },
    { href: '#/welcome', icon: 'shield', label: 'Why AddisGo' },
  ],
  customer: [
    { href: '#/', icon: 'home', label: 'Home' },
    { href: '#/ride', icon: 'car', label: 'Book a ride', primary: true },
    { href: '#/dashboard', icon: 'grid', label: 'Dashboard' },
    { href: '#/tours', icon: 'compass', label: 'City tours' },
    { href: '#/trips', icon: 'route', label: 'My trips' },
    { href: '#/profile', icon: 'user', label: 'Profile' },
  ],
  driver: [
    { href: '#/', icon: 'home', label: 'Home' },
    { href: '#/driver', icon: 'grid', label: 'Dashboard', primary: true },
    { href: '#/driver?tab=requests', icon: 'car', label: 'Requests' },
    { href: '#/trips', icon: 'route', label: 'Trips' },
    { href: '#/tours', icon: 'compass', label: 'Tours' },
    { href: '#/profile', icon: 'user', label: 'Profile' },
  ],
  admin: [
    { href: '#/', icon: 'home', label: 'Home' },
    { href: '#/admin', icon: 'grid', label: 'Overview', primary: true },
    { href: '#/admin?tab=drivers', icon: 'car', label: 'Drivers' },
    { href: '#/admin?tab=users', icon: 'users', label: 'People' },
    { href: '#/admin?tab=safety', icon: 'shield', label: 'Safety' },
    { href: '#/profile', icon: 'user', label: 'Profile' },
  ],
};

const ADMIN_EXTRA = [
  { href: '#/admin?tab=bookings', icon: 'ticket', label: 'Rides' },
  { href: '#/admin?tab=tours', icon: 'compass', label: 'Tours' },
  { href: '#/admin?tab=audit', icon: 'flag', label: 'Audit log' },
];

export function navFor(user) {
  if (!user) return NAV.guest;
  return NAV[user.role] || NAV.customer;
}

function sidebarLinks(user) {
  const items = navFor(user);
  const main = items
    .slice(0, user?.role === 'admin' ? 3 : items.length)
    .map((item) => link(item, true))
    .join('');
  const extra =
    user?.role === 'admin'
      ? `<p class="nav-label">Operations</p>${ADMIN_EXTRA.map((i) => link(i, true)).join('')}`
      : '';
  return `${main}${extra}`;
}

function link(item, withIcon = false) {
  return `<a class="nav-link" href="${item.href}" data-nav="${item.href}" title="${esc(item.label)}">
    ${withIcon ? icon(item.icon, 19) : ''}
    <span>${esc(item.label)}</span>
  </a>`;
}

function userCard(user) {
  const role = roleLabel(user.role);
  return `<a class="side-user" href="#/profile">
    ${avatar(user, 38)}
    <span class="side-user-meta">
      <strong>${esc(user.name)}</strong>
      <small>${esc(user.role === 'driver' && user.driver ? `${user.driver.vehicle_class.toUpperCase()} · ${role}` : role)}</small>
    </span>
    ${icon('chevron-right', 16)}
  </a>`;
}

export function renderShell() {
  const app = $('#app');
  if (!app) return () => {};
  const user = state.user;

  app.innerHTML = `
    <div class="app-shell ${user ? 'is-authed' : 'is-guest'}">
      <aside class="sidebar" aria-label="Main navigation">
        <a class="brand" href="#/">
          ${logoMark(38)}
          <span class="brand-text"><strong>AddisGo</strong><small>City guide &amp; rides</small></span>
        </a>
        <nav class="side-nav">
          <p class="nav-label">${user ? 'Your Addis' : 'Explore'}</p>
          ${sidebarLinks(user)}
        </nav>
        <div class="sidebar-promo">
          <span class="promo-icon">${icon('leaf', 18)}</span>
          <p><strong>Electric first.</strong> Every E2 ride is zero-tailpipe and driven by a verified local.</p>
          <a href="#/ride">Book E2 ${icon('arrow-right', 14)}</a>
        </div>
        <div class="sidebar-foot">
          ${user ? userCard(user) : `
            <a class="btn btn-primary btn-block" href="#/login">Sign in</a>
            <a class="btn btn-ghost btn-block" href="#/register">Create account</a>
          `}
        </div>
      </aside>

      <div class="main-column">
        <header class="topbar ${user ? 'topbar-authed' : 'topbar-guest'}">
          <div class="topbar-inner">
            <a class="topbar-brand" href="#/">
              ${logoMark(30)}
              <span class="brand-text"><strong>AddisGo</strong></span>
            </a>
            ${user ? `
              <p class="topbar-context" id="topbar-context">${greeting()}, ${esc(user.name.split(' ')[0])}</p>
              <div class="topbar-actions">
                <a class="btn btn-sm btn-primary topbar-cta" href="${user.role === 'driver' ? '#/driver' : '#/ride'}">
                  ${icon(user.role === 'driver' ? 'power' : 'car', 16)}
                  <span>${user.role === 'driver' ? 'Driver mode' : 'Request a ride'}</span>
                </a>
                <button type="button" class="icon-btn notify-btn" id="notify-btn" aria-label="Notifications" aria-expanded="false">
                  ${icon('bell', 20)}
                  <span class="notify-dot" id="notify-dot" hidden></span>
                </button>
                <button type="button" class="avatar-btn" id="avatar-btn" aria-label="Account menu" aria-expanded="false">
                  ${avatar(user, 34)}
                  ${icon('chevron-down', 14)}
                </button>
              </div>
            ` : `
              <nav class="topbar-nav" aria-label="Main navigation">
                <a href="#/" class="topbar-nav-link" data-nav="#/">Home</a>
                <a href="#/tours" class="topbar-nav-link" data-nav="#/tours">City tours</a>
                <a href="#/welcome" class="topbar-nav-link" data-nav="#/welcome">Why AddisGo</a>
              </nav>
              <div class="topbar-actions">
                <a class="btn btn-sm btn-ghost" href="#/login">Sign in</a>
                <a class="btn btn-sm btn-cyan" href="#/register">Book a ride</a>
              </div>
            `}
          </div>
        </header>

        <div id="notify-panel" class="notify-panel" hidden aria-label="Notifications"></div>
        <div id="avatar-menu" class="dropdown" hidden></div>

        <main id="view" class="view" tabindex="-1"></main>

        <nav class="bottom-nav" aria-label="Quick navigation">
          ${navFor(user).slice(0, 5).map((item) => `
            <a href="${item.href}" class="bottom-link" data-nav="${item.href}">
              <span class="bottom-icon">${icon(item.icon, 21)}</span>
              <span>${esc(item.label)}</span>
            </a>
          `).join('')}
        </nav>
      </div>
    </div>
  `;

  const cleanups = [];
  if (user) {
    cleanups.push(mountAccountMenus());
    const chatCleanup = mountGlobalOverlayChat(user);
    if (chatCleanup) cleanups.push(chatCleanup);
  }
  cleanups.push(mountNotifications());
  const navHandler = on(app, '[data-nav]', 'click', () => {
    closePanels();
  });
  cleanups.push(navHandler);

  return () => {
    cleanups.forEach((fn) => {
      try { fn(); } catch { /* ignore */ }
    });
  };
}

export function closePanels() {
  const panel = $('#notify-panel');
  const menu = $('#avatar-menu');
  if (panel) panel.hidden = true;
  if (menu) menu.hidden = true;
  $('#notify-btn')?.setAttribute('aria-expanded', 'false');
  $('#avatar-btn')?.setAttribute('aria-expanded', 'false');
}

function mountAccountMenus() {
  const user = state.user;
  if (!user) return () => {};
  const menu = $('#avatar-menu');
  const btn = $('#avatar-btn');
  if (!menu || !btn) return () => {};

  menu.innerHTML = `
    <div class="dropdown-head">
      ${avatar(user, 42)}
      <div>
        <strong>${esc(user.name)}</strong>
        <small>${esc(user.email)}</small>
      </div>
    </div>
    <div class="dropdown-links">
      <a href="#/profile" class="dropdown-item">${icon('user', 17)} Profile &amp; safety</a>
      <a href="#/trips" class="dropdown-item">${icon('route', 17)} Trips &amp; receipts</a>
      ${user.role === 'driver' ? `<a href="#/driver" class="dropdown-item">${icon('car', 17)} Driver dashboard</a>` : ''}
      ${user.role === 'admin' ? `<a href="#/admin" class="dropdown-item">${icon('grid', 17)} Admin CRM</a>` : ''}
      <button type="button" class="dropdown-item danger" id="menu-logout">${icon('log-out', 17)} Sign out</button>
    </div>
  `;

  const toggle = (event) => {
    event.stopPropagation();
    const isOpen = menu.hidden;
    closePanels();
    menu.hidden = !isOpen;
    btn.setAttribute('aria-expanded', String(isOpen));
  };
  btn.addEventListener('click', toggle);

  const logoutHandler = async () => {
    try {
      await logout();
      toast('Signed out. See you soon.');
      window.location.hash = '#/';
    } catch (error) {
      toastError(error, 'Could not sign out.');
    }
  };
  menu.querySelector('#menu-logout')?.addEventListener('click', logoutHandler);

  const docClick = (event) => {
    if (!menu.hidden && !menu.contains(event.target) && event.target !== btn && !btn.contains(event.target)) {
      menu.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
    }
  };
  document.addEventListener('click', docClick);

  return () => {
    btn.removeEventListener('click', toggle);
    menu.querySelector('#menu-logout')?.removeEventListener('click', logoutHandler);
    document.removeEventListener('click', docClick);
  };
}

let notificationsPoller = null;

function mountNotifications() {
  const btn = $('#notify-btn');
  const panel = $('#notify-panel');
  if (!btn || !panel || !state.user) return () => {};

  let items = [];
  let unread = 0;

  const render = () => {
    const dot = $('#notify-dot');
    if (dot) {
      dot.hidden = unread === 0;
      dot.textContent = unread > 9 ? '9+' : String(unread || '');
    }
    panel.innerHTML = `
      <div class="panel-head">
        <div><strong>Notifications</strong><small>${unread ? `${unread} unread` : 'You are all caught up'}</small></div>
        <button type="button" class="btn btn-ghost btn-xs" id="mark-read" ${unread ? '' : 'disabled'}>Mark all read</button>
      </div>
      <div class="notify-list">
        ${items.length ? items.map((n) => `
          <div class="notify-item ${n.is_read ? '' : 'is-unread'}">
            <span class="notify-icon icon-${esc(n.kind)}">${icon(n.kind === 'safety' ? 'shield' : n.kind === 'tour' ? 'compass' : n.kind === 'driver' ? 'car' : n.kind === 'rating' ? 'star' : n.kind === 'account' ? 'user' : 'bell', 17)}</span>
            <div class="notify-copy">
              <strong>${esc(n.title)}</strong>
              <p>${esc(n.body)}</p>
              <small>${esc(relativeShort(n.created_at))}</small>
            </div>
          </div>
        `).join('') : `<p class="panel-empty">${icon('bell', 22)} Nothing yet — book a ride or join a tour to get updates.</p>`}
      </div>
    `;
    panel.querySelector('#mark-read')?.addEventListener('click', async () => {
      try {
        await api('/notifications/read', { method: 'POST' });
        items = items.map((n) => ({ ...n, is_read: true }));
        unread = 0;
        render();
      } catch (error) {
        toastError(error);
      }
    });
  };

  const load = async () => {
    try {
      const data = await api('/notifications');
      items = data.notifications || [];
      unread = data.unread || 0;
      render();
    } catch {
      /* silent */
    }
  };

  const toggle = (event) => {
    event.stopPropagation();
    const isOpen = panel.hidden;
    closePanels();
    panel.hidden = !isOpen;
    btn.setAttribute('aria-expanded', String(isOpen));
    if (isOpen) void load();
  };
  btn.addEventListener('click', toggle);

  const docClick = (event) => {
    if (!panel.hidden && !panel.contains(event.target) && event.target !== btn && !btn.contains(event.target)) {
      panel.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
    }
  };
  document.addEventListener('click', docClick);

  render();
  notificationsPoller = createPoller(load, 25000);
  const onRefresh = () => notificationsPoller?.kick();
  window.addEventListener('notifications:refresh', onRefresh);

  return () => {
    btn.removeEventListener('click', toggle);
    document.removeEventListener('click', docClick);
    window.removeEventListener('notifications:refresh', onRefresh);
    notificationsPoller?.stop();
    notificationsPoller = null;
  };
}

function relativeShort(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export function setActiveNav(hashPath) {
  const path = hashPath.split('?')[0];
  const search = hashPath.split('?')[1] || '';
  const tab = new URLSearchParams(search).get('tab');
  document.querySelectorAll('[data-nav]').forEach((el) => {
    const target = el.getAttribute('data-nav') || '';
    const [targetPath, targetQuery] = target.split('?');
    const targetTab = new URLSearchParams(targetQuery || '').get('tab');
    let active = targetPath === path;
    if (active && targetTab) active = tab === targetTab;
    else if (active && tab && targetPath === '#/admin') active = false;
    if (path === '#/tour/1') active = false;
    if (path.startsWith('#/tour/') && targetPath === '#/tours') active = true;
    el.classList.toggle('is-active', active);
    if (active) el.setAttribute('aria-current', 'page');
    else el.removeAttribute('aria-current');
  });
}

export function setContext(text) {
  const el = $('#topbar-context');
  if (el && text) el.textContent = text;
}

export function pageHead({ eyebrow = '', title, description = '', actions = '', compact = false }) {
  return `<header class="page-head ${compact ? 'is-compact' : ''}">
    <div class="page-head-copy">
      ${eyebrow ? `<p class="eyebrow">${esc(eyebrow)}</p>` : ''}
      <h1 class="page-title">${esc(title)}</h1>
      ${description ? `<p class="page-desc">${esc(description)}</p>` : ''}
    </div>
    ${actions ? `<div class="page-head-actions">${actions}</div>` : ''}
  </header>`;
}

export function sectionHead(title, { description = '', action = '' } = {}) {
  return `<div class="section-head">
    <div>
      <h2>${esc(title)}</h2>
      ${description ? `<p>${esc(description)}</p>` : ''}
    </div>
    ${action}
  </div>`;
}

export function emptyState({ icon: iconName = 'compass', title, text = '', action = '' }) {
  return `<div class="empty-state">
    <span class="empty-icon">${icon(iconName, 26)}</span>
    <h3>${esc(title)}</h3>
    ${text ? `<p>${esc(text)}</p>` : ''}
    ${action}
  </div>`;
}

export function statCard({ label, value, hint = '', icon: iconName = 'trending-up', tone = 'green', href = '' }) {
  const inner = `
    <span class="stat-icon tone-${esc(tone)}">${icon(iconName, 19)}</span>
    <span class="stat-copy">
      <small>${esc(label)}</small>
      <strong>${esc(value)}</strong>
      ${hint ? `<em>${esc(hint)}</em>` : ''}
    </span>
  `;
  return href
    ? `<a class="stat-card" href="${href}">${inner}${icon('arrow-up-right', 16, 'stat-arrow')}</a>`
    : `<div class="stat-card">${inner}</div>`;
}

export function skeletons(count = 3, className = 'card-skeleton') {
  return Array.from({ length: count }, () => `<div class="${className}" aria-hidden="true"></div>`).join('');
}

export function errorBlock(message, { retryLabel = 'Try again', id = 'retry-block' } = {}) {
  return `<div class="error-block" role="alert">
    <span class="error-icon">${icon('info', 22)}</span>
    <div><strong>We hit a snag</strong><p>${esc(message)}</p></div>
    <button type="button" class="btn btn-sm btn-ghost" id="${id}">${esc(retryLabel)}</button>
  </div>`;
}
