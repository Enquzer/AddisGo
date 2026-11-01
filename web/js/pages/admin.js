import { api } from '../api.js';
import { state } from '../store.js';
import { icon } from '../ui/icons.js';
import {
  esc, money, date, dateTime, relative, avatar, stars, statusBadge, vehicleClass,
  plural, roleLabel, toLocalInput, defaultSchedule, km, minutes,
} from '../ui/format.js';
import {
  pageHead, sectionHead, emptyState, errorBlock, skeletons, statCard,
} from '../ui/layout.js';
import { openModal, confirmModal } from '../ui/modal.js';
import { toast, toastError } from '../ui/toast.js';
import { $, withBusy } from '../ui/dom.js';
import { RideMap } from '../ui/map.js';

const TABS = [
  { key: 'overview', label: 'Overview', icon: 'grid' },
  { key: 'insights', label: 'Insights', icon: 'trending-up' },
  { key: 'map', label: 'Area map', icon: 'map-pin' },
  { key: 'revenue', label: 'Revenue', icon: 'wallet' },
  { key: 'analytics', label: 'Audience', icon: 'globe' },
  { key: 'drivers', label: 'Drivers', icon: 'car' },
  { key: 'users', label: 'People', icon: 'users' },
  { key: 'bookings', label: 'Rides', icon: 'ticket' },
  { key: 'tours', label: 'Tours', icon: 'compass' },
  { key: 'events', label: 'Events', icon: 'calendar' },
  { key: 'routes', label: 'Routes', icon: 'map' },
  { key: 'fares', label: 'Fares', icon: 'wallet' },
  { key: 'safety', label: 'Safety', icon: 'shield' },
  { key: 'email', label: 'Email & Google', icon: 'mail' },
  { key: 'site', label: 'Website', icon: 'globe' },
  { key: 'audit', label: 'Audit log', icon: 'flag' },
];

const DRIVER_FILTERS = ['all', 'pending', 'approved', 'suspended'];
const BOOKING_FILTERS = ['all', 'requested', 'accepted', 'arriving', 'in_progress', 'completed', 'cancelled'];
const REPORT_FILTERS = ['open', 'resolved', 'dismissed', 'all'];
const ROLE_FILTERS = ['all', 'customer', 'driver', 'admin'];
const TOUR_FILTERS = ['all', 'upcoming', 'completed', 'cancelled'];
const EVENT_FILTERS = ['all', 'published', 'draft', 'cancelled'];
const ROUTE_FILTERS = ['all', 'active', 'inactive'];
const BOOKING_STATUSES = ['requested', 'accepted', 'arriving', 'in_progress', 'completed', 'cancelled'];
const VEHICLE_CLASSES = ['e2', 'comfort', 'van'];
const EVENT_CATEGORIES = ['culture', 'music', 'food', 'sport', 'community', 'art', 'other'];
const TOUR_THEMES = ['entoto', 'merkato', 'museum', 'bole', 'custom'];
const TOUR_STATUSES = ['upcoming', 'completed', 'cancelled'];
const ACTIVE_RIDES = ['requested', 'accepted', 'arriving', 'in_progress'];
const ADDIS = { lat: 9.03, lng: 38.74 };

const titleCase = (value) => String(value || '')
  .replace(/_/g, ' ')
  .replace(/\b\w/g, (letter) => letter.toUpperCase());

const pill = (label, tone = 'muted') => `<span class="badge badge-${esc(tone)}">${esc(label)}</span>`;

const actionBtn = (label, iconName, attrs, variant = '') => (
  `<button type="button" class="btn btn-xs ${variant || 'btn-ghost'}" ${attrs}>${icon(iconName, 13)} <span>${esc(label)}</span></button>`
);

const linkBtn = (label, iconName, href) => (
  `<a class="btn btn-xs btn-ghost" href="${href}">${icon(iconName, 13)} <span>${esc(label)}</span></a>`
);

const rowActions = (...buttons) => `<div class="row-actions">${buttons.filter(Boolean).join('')}</div>`;

const tableBlock = (head, rows, empty, className = '') => (rows
  ? `<div class="table-wrap"><table class="data-table ${className}"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>`
  : emptyState(empty));

const toolbar = ({ title, description, actions = '' }) => `
  <div class="admin-toolbar admin-toolbar-head">
    <div class="admin-toolbar-copy">
      <h2>${esc(title)}</h2>
      ${description ? `<p>${esc(description)}</p>` : ''}
    </div>
    ${actions ? `<div class="admin-toolbar-actions">${actions}</div>` : ''}
  </div>
`;

const filterBar = ({ tabs = '', search = '' }) => `<div class="admin-toolbar">
  ${tabs ? `<div class="tabs" role="tablist">${tabs}</div>` : '<span></span>'}
  ${search}
</div>`;

const searchBox = (id, placeholder, value) => `<label class="search-field">
  ${icon('search', 15)}
  <input type="search" id="${id}" placeholder="${esc(placeholder)}" aria-label="${esc(placeholder)}" value="${esc(value)}" />
</label>`;

/* ------------------------------------------------------------------ */
/* Form helpers                                                        */
/* ------------------------------------------------------------------ */

function inputField({
  label, name, value = '', type = 'text', placeholder = '', required = false,
  min = '', max = '', step = '', hint = '', wide = false, readonly = false,
}) {
  return `<label class="field ${wide ? 'field-wide' : ''}">
    <span class="field-label">${esc(label)}${required ? ' *' : ''}</span>
    <input class="field-input" type="${type}" name="${name}" value="${esc(value)}"
      ${placeholder ? `placeholder="${esc(placeholder)}"` : ''}
      ${required ? 'required' : ''}
      ${min !== '' ? `min="${min}"` : ''}
      ${max !== '' ? `max="${max}"` : ''}
      ${step !== '' ? `step="${step}"` : ''}
      ${readonly ? 'readonly' : ''} />
    ${hint ? `<span class="field-hint">${esc(hint)}</span>` : ''}
  </label>`;
}

function textareaField({
  label, name, value = '', rows = 3, placeholder = '', maxLength = 400, hint = '', wide = true, required = false,
}) {
  return `<label class="field ${wide ? 'field-wide' : ''}">
    <span class="field-label">${esc(label)}${required ? ' *' : ''}</span>
    <textarea class="field-input" name="${name}" rows="${rows}" maxlength="${maxLength}"
      ${placeholder ? `placeholder="${esc(placeholder)}"` : ''} ${required ? 'required' : ''}>${esc(value)}</textarea>
    ${hint ? `<span class="field-hint">${esc(hint)}</span>` : ''}
  </label>`;
}

function selectField({ label, name, value, options, hint = '', wide = false }) {
  return `<label class="field ${wide ? 'field-wide' : ''}">
    <span class="field-label">${esc(label)}</span>
    <select class="field-input" name="${name}">
      ${options.map((option) => {
        const item = typeof option === 'string' ? { value: option, label: titleCase(option) } : option;
        return `<option value="${esc(item.value)}" ${String(item.value) === String(value) ? 'selected' : ''}>${esc(item.label)}</option>`;
      }).join('')}
    </select>
    ${hint ? `<span class="field-hint">${esc(hint)}</span>` : ''}
  </label>`;
}

function photoAttachField({ label = 'Photo attachment', name = 'image_url', value = '', hint = 'Upload from computer or paste an image URL.' }) {
  return `<div class="field field-wide photo-attach-field">
    <span class="field-label">${esc(label)}</span>
    <div class="photo-attach-row">
      <div class="photo-preview-box" data-preview-box tabindex="0" role="button" aria-label="Upload photo from computer" title="Click to choose a photo from your computer or drag & drop">
        ${value ? `<img src="${esc(value)}" alt="Preview" class="photo-preview-img" /><button type="button" class="photo-remove-btn" data-remove-photo title="Remove photo" aria-label="Remove photo">✕</button>` : `<span class="photo-placeholder">${icon('image', 22)}<span>Upload from computer</span><small style="font-size:0.65rem;color:var(--text-muted);margin-top:2px;">or drag &amp; drop</small></span>`}
      </div>
      <div class="photo-inputs">
        <div class="photo-btn-group">
          <button type="button" class="btn btn-sm btn-primary photo-upload-btn" data-photo-btn>
            ${icon('upload', 14)} Choose photo from computer
          </button>
          <input type="file" accept="image/jpeg,image/png,image/webp,image/*" data-photo-file style="display:none;" />
          <span class="field-hint" style="margin:0;">${esc(hint)}</span>
        </div>
        <input type="url" name="${name}" value="${esc(value)}" placeholder="Or paste image URL (https://...)" class="field-input photo-url-input" data-photo-url />
      </div>
    </div>
  </div>`;
}

function readFileAsOptimizedDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read file.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Invalid image file.'));
      img.onload = () => {
        const maxDim = 1200;
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function setupPhotoAttachment(form, initialUrl = '') {
  const fileInput = form.querySelector('[data-photo-file]');
  const photoBtn = form.querySelector('[data-photo-btn]');
  const urlInput = form.querySelector('[data-photo-url]');
  const previewBox = form.querySelector('[data-preview-box]');
  if (!urlInput || !previewBox) return;

  const updatePreview = (url) => {
    const clean = String(url || '').trim();
    if (clean) {
      previewBox.innerHTML = `
        <img src="${esc(clean)}" alt="Preview" class="photo-preview-img" onerror="this.onerror=null;this.src='data:image/svg+xml;utf8,<svg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'40\\' height=\\'40\\' viewBox=\\'0 0 24 24\\' fill=\\'none\\' stroke=\\'%23888\\' stroke-width=\\'2\\'><rect width=\\'18\\' height=\\'18\\' x=\\'3\\' y=\\'3\\' rx=\\'2\\'/></svg>';" />
        <button type="button" class="photo-remove-btn" data-remove-photo title="Remove photo" aria-label="Remove photo">✕</button>
      `;
      previewBox.querySelector('[data-remove-photo]')?.addEventListener('click', (e) => {
        e.stopPropagation();
        urlInput.value = '';
        if (fileInput) fileInput.value = '';
        updatePreview('');
      });
    } else {
      previewBox.innerHTML = `<span class="photo-placeholder">${icon('image', 22)}<span>Upload from computer</span><small style="font-size:0.65rem;color:var(--text-muted);margin-top:2px;">or drag &amp; drop</small></span>`;
    }
  };

  updatePreview(initialUrl);

  urlInput.addEventListener('input', () => {
    updatePreview(urlInput.value.trim());
  });

  const handleFile = async (file) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast('Please choose a valid image file (JPEG, PNG, WebP).', { type: 'error' });
      return;
    }
    previewBox.innerHTML = `<span class="photo-placeholder">${icon('loader', 20)}<span>Uploading ${esc(file.name)}...</span></span>`;
    try {
      const dataUrl = await readFileAsOptimizedDataUrl(file);
      const res = await api('/upload', { method: 'POST', body: { data: dataUrl, filename: file.name, type: 'image' } });
      if (res && res.url) {
        urlInput.value = res.url;
        updatePreview(res.url);
        toast('Photo uploaded successfully from computer.');
      } else {
        throw new Error('Upload response missing url');
      }
    } catch (err) {
      toast('Could not upload photo: ' + (err.message || 'Error'), { type: 'error' });
      updatePreview(urlInput.value.trim());
    }
  };

  photoBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    fileInput?.click();
  });

  previewBox.addEventListener('click', (e) => {
    if (e.target.closest('[data-remove-photo]')) return;
    fileInput?.click();
  });

  previewBox.addEventListener('dragover', (e) => {
    e.preventDefault();
    previewBox.style.borderColor = 'var(--accent, #008080)';
  });
  previewBox.addEventListener('dragleave', () => {
    previewBox.style.borderColor = '';
  });
  previewBox.addEventListener('drop', (e) => {
    e.preventDefault();
    previewBox.style.borderColor = '';
    const file = e.dataTransfer?.files?.[0];
    if (file) handleFile(file);
  });

  if (fileInput) {
    fileInput.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      if (file) handleFile(file);
    });
  }
}

function openFormModal({ title, eyebrow = '', size = 'lg', body, submitLabel = 'Save changes', onInit, onSubmit }) {
  return new Promise((resolve) => {
    const formId = `admin-form-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    let settled = false;
    const modal = openModal({
      title,
      eyebrow,
      size,
      body: `<form class="form" id="${formId}" data-admin-form novalidate>
        <div class="form-alert" data-form-error role="alert" hidden></div>
        ${body}
      </form>`,
      footer: `
        <button type="button" class="btn btn-ghost" data-act="cancel">Cancel</button>
        <button type="submit" form="${formId}" class="btn btn-primary" data-act="save">
          ${icon('check', 15)} ${esc(submitLabel)}
        </button>
      `,
      onClose: () => {
        if (!settled) {
          settled = true;
          resolve(null);
        }
      },
    });

    const form = modal.body.querySelector('[data-admin-form]');
    const errorBox = modal.body.querySelector('[data-form-error]');
    const save = modal.footer.querySelector('[data-act="save"]');

    if (onInit) {
      try {
        onInit(form, modal);
      } catch (err) {
        console.error('Modal onInit error:', err);
      }
    }

    modal.footer.querySelector('[data-act="cancel"]').addEventListener('click', () => {
      settled = true;
      modal.close();
      resolve(null);
    });

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      errorBox.hidden = true;
      save.disabled = true;
      try {
        await onSubmit(new FormData(form), form);
        settled = true;
        modal.close();
        resolve(true);
      } catch (error) {
        errorBox.hidden = false;
        errorBox.innerHTML = `${icon('info', 16)} <span>${esc(error.message || 'Could not save these changes.')}</span>`;
      } finally {
        save.disabled = false;
      }
    });
  });
}

function formObject(formData) {
  const out = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === 'string') out[key] = value.trim();
  }
  return out;
}

function localToIso(value, field) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) throw new Error(`${field} must be a valid date and time.`);
  return parsed.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default async function renderAdmin(view, ctx) {
  let tab = ctx.query.get('tab') || 'overview';
  if (!TABS.some((t) => t.key === tab)) tab = 'overview';

  view.innerHTML = `
    <section class="admin-page">
      ${pageHead({
        eyebrow: 'Operations CRM',
        title: 'The city, in one control room.',
        description: 'Tables for every part of the business — approve drivers, manage people and rides, publish events and routes, edit fares, review safety and keep the website current.',
        actions: `
          <span class="badge badge-soft admin-mode">${icon('shield', 13)} Admin</span>
          <button type="button" class="btn btn-ghost" id="admin-refresh">${icon('refresh', 16)} Refresh</button>
        `,
      })}

      <div class="stat-strip admin-stats" id="admin-stats">${skeletons(4, 'stat-skeleton')}</div>

      <section class="panel admin-shell">
        <div class="tabs admin-tabs" role="tablist" aria-label="Operations sections">
          ${TABS.map((t) => `
            <button type="button" class="tab ${t.key === tab ? 'is-active' : ''}" role="tab"
              data-tab="${t.key}" aria-selected="${t.key === tab}" aria-controls="admin-panel-${t.key}">
              ${icon(t.icon, 15)} ${esc(t.label)}
            </button>
          `).join('')}
        </div>

        <div class="tab-panels">
          ${TABS.map((t) => `
            <section class="tab-panel" id="admin-panel-${t.key}" data-panel="${t.key}" role="tabpanel" ${t.key === tab ? '' : 'hidden'}>
              <div id="admin-body-${t.key}">${skeletons(3, 'line-skeleton')}</div>
            </section>
          `).join('')}
        </div>
      </section>
    </section>
  `;

  const pageEl = $('.admin-page', view);
  const statsEl = $('#admin-stats', view);
  const selfId = state.user?.id;

  const data = {
    overview: null,
    insights: null,
    map: null,
    revenue: null,
    analytics: null,
    drivers: [],
    users: [],
    bookings: [],
    tours: [],
    events: [],
    routes: [],
    fares: [],
    reports: [],
    email: null,
    subscribers: [],
    site: null,
    audit: [],
  };
  const loaded = new Set();
  const loading = new Set();

  const filters = {
    drivers: 'all',
    users: 'all',
    bookings: 'all',
    tours: 'all',
    events: 'all',
    routes: 'all',
    reports: 'open',
  };
  const queries = {
    drivers: '',
    users: '',
    bookings: '',
    tours: '',
    events: '',
    routes: '',
  };
  let userTimer = null;

  const bodyFor = (key) => $(`#admin-body-${key}`, view);

  const keepFocus = (paint, inputId) => {
    const input = $(`#${inputId}`, view);
    const start = input?.selectionStart;
    paint();
    const next = $(`#${inputId}`, view);
    if (next) {
      next.focus({ preventScroll: true });
      if (start != null) next.setSelectionRange(start, start);
    }
  };

  /* ---------------------------------------------------------------- */
  /* Overview                                                          */
  /* ---------------------------------------------------------------- */

  const paintOverview = () => {
    const host = bodyFor('overview');
    if (!host || !data.overview) return;
    const { stats, chart, recent_bookings: recent, pending_drivers: pending } = data.overview;

    if (statsEl) {
      statsEl.innerHTML = [
        statCard({ label: 'Riders', value: String(stats.customers), hint: `${stats.total_users} total people`, icon: 'users', tone: 'blue' }),
        statCard({ label: 'Drivers online', value: String(stats.drivers_online), hint: `${stats.drivers_total} approved · ${stats.drivers_pending} pending`, icon: 'car', tone: 'green' }),
        statCard({ label: 'Live rides', value: String(stats.active_rides), hint: `${stats.today_bookings} requested today`, icon: 'navigation', tone: stats.active_rides ? 'amber' : 'violet' }),
        statCard({ label: 'Revenue today', value: money(stats.revenue_today), hint: `${money(stats.revenue_total)} all time`, icon: 'wallet', tone: 'green' }),
        statCard({ label: 'Open reports', value: String(stats.reports_open), hint: stats.reports_open ? 'Review the safety desk' : 'All clear', icon: 'shield', tone: stats.reports_open ? 'red' : 'green', href: '#/admin?tab=safety' }),
        statCard({ label: 'Avg driver rating', value: `${Number(stats.avg_rating || 5).toFixed(1)} ★`, hint: `${stats.completed_total} trips completed`, icon: 'star', tone: 'amber' }),
        statCard({ label: 'Upcoming tours', value: String(stats.tours_upcoming), hint: 'Small-group schedule', icon: 'compass', tone: 'violet', href: '#/admin?tab=tours' }),
        statCard({ label: 'Pending drivers', value: String(stats.drivers_pending), hint: stats.drivers_pending ? 'Waiting for approval' : 'Queue is clear', icon: 'clock', tone: stats.drivers_pending ? 'amber' : 'green', href: '#/admin?tab=drivers' }),
      ].join('');
    }

    const maxRides = Math.max(1, ...chart.map((day) => day.rides));
    const weekRides = chart.reduce((sum, day) => sum + day.rides, 0);
    const weekRevenue = chart.reduce((sum, day) => sum + day.revenue, 0);

    host.innerHTML = `
      ${toolbar({
        title: 'Command centre',
        description: 'A seven-day pulse, the driver approval queue and the newest rides — all in tables.',
        actions: '<a class="btn btn-sm btn-ghost" href="#/admin?tab=bookings">' + icon('ticket', 15) + ' Rides desk</a>',
      })}

      <section class="panel admin-panel">
        ${sectionHead('Last seven days', {
          description: `${plural(weekRides, 'ride')} requested · ${money(weekRevenue)} completed revenue.`,
        })}
        ${tableBlock(
          '<th style="width:170px">Day</th><th style="width:130px">Date</th><th class="num" style="width:100px">Rides</th><th class="num" style="width:140px">Revenue</th><th>Volume Distribution</th>',
          chart.map((day) => {
            const parsed = new Date(`${day.date}T00:00:00`);
            const width = day.rides ? Math.max(8, Math.round((day.rides / maxRides) * 100)) : 0;
            const isToday = day.date === new Date().toISOString().slice(0, 10);
            return `<tr class="${isToday ? 'is-highlight' : ''}">
              <td class="nowrap">
                <strong>${esc(parsed.toLocaleDateString(undefined, { weekday: 'long' }))}</strong>
                ${isToday ? ' <span class="badge badge-success" style="font-size:10px;padding:2px 6px;">Today</span>' : ''}
              </td>
              <td class="nowrap text-muted">${esc(date(day.date))}</td>
              <td class="num"><strong>${day.rides}</strong></td>
              <td class="num"><strong class="color-brand">${esc(money(day.revenue))}</strong></td>
              <td>
                <div class="volume-bar-cell">
                  <div class="mini-bar"><i style="width:${width}%"></i></div>
                  <span class="volume-label">${day.rides ? `${day.rides} ride${day.rides > 1 ? 's' : ''}` : '<span class="text-muted">0</span>'}</span>
                </div>
              </td>
            </tr>`;
          }).join(''),
          { icon: 'route', title: 'No activity yet', text: 'Rides will appear here as soon as the first booking is made.' },
          'seven-days-table'
        )}
      </section>

      <section class="panel admin-panel">
        ${sectionHead('Driver approvals', {
          description: pending.length ? 'Newest applications waiting for a decision.' : 'No applications are waiting.',
          action: '<a class="text-link" href="#/admin?tab=drivers">Open drivers ' + icon('arrow-right', 14) + '</a>',
        })}
        ${tableBlock(
          '<th>Driver</th><th>Vehicle</th><th>Applied</th><th class="actions-col">Actions</th>',
          pending.map((driver) => `<tr class="is-highlight">
            <td><div class="table-person">${avatar(driver, 34)}<span><strong>${esc(driver.name)}</strong><small>${esc(driver.email)}</small></span></div></td>
            <td><span class="table-vehicle"><span class="badge badge-soft tone-${vehicleClass(driver.vehicle_class).tone}">${esc(vehicleClass(driver.vehicle_class).name)}</span><small>${esc(driver.make_model)} · <span class="plate">${esc(driver.plate)}</span></small></span></td>
            <td class="nowrap">${esc(relative(driver.created_at))}</td>
            <td class="actions-col">${rowActions(
              actionBtn('Approve', 'check', `data-driver-status="approved" data-driver-id="${driver.id}"`, 'btn-primary'),
              actionBtn('Suspend', 'ban', `data-driver-status="suspended" data-driver-id="${driver.id}"`, 'btn-ghost btn-danger-text'),
            )}</td>
          </tr>`).join(''),
          { icon: 'check-circle', title: 'Approvals are clear', text: 'New driver applications appear here the moment they register.' },
        )}
      </section>

      <section class="panel admin-panel">
        ${sectionHead('Newest rides', {
          description: 'The latest bookings across every class.',
          action: '<a class="text-link" href="#/admin?tab=bookings">All rides ' + icon('arrow-right', 14) + '</a>',
        })}
        ${tableBlock(
          '<th>Code</th><th>Route</th><th>Rider</th><th>Driver</th><th>Status</th><th class="num">Fare</th><th>Booked</th>',
          recent.map((booking) => `<tr>
            <td><a class="mono-link" href="#/ride/${booking.id}">${esc(booking.code)}</a></td>
            <td class="cell-route">${esc(booking.pickup)} <span class="muted">→</span> ${esc(booking.dropoff)}</td>
            <td>${esc(booking.customer?.name || '—')}</td>
            <td>${esc(booking.driver?.name || 'Unmatched')}</td>
            <td>${statusBadge(booking.status)}</td>
            <td class="num">${esc(money(booking.fare))}</td>
            <td class="nowrap">${esc(relative(booking.created_at))}</td>
          </tr>`).join(''),
          { icon: 'ticket', title: 'No rides yet', text: 'Bookings will appear here as soon as riders request them.' },
        )}
      </section>
    `;
  };

  /* ---------------------------------------------------------------- */
  /* Insights                                                          */
  /* ---------------------------------------------------------------- */

  const ASPECT_LABELS = {
    car_condition: 'Car condition',
    comfort: 'Comfort',
    cleanliness: 'Tidiness',
    service: 'Service',
    safety: 'Safety',
    punctuality: 'Punctuality',
  };

  const paintInsights = () => {
    const host = bodyFor('insights');
    if (!host || !data.insights) return;
    const ins = data.insights;
    const ratings = ins.ratings;
    const blame = ins.cancellations.by_blame;
    const maxStars = Math.max(1, ...ratings.distribution.map((row) => row.count));
    const hourLabel = (hour) => `${String(hour).padStart(2, '0')}:00`;
    const share = (count) => (ratings.total ? Math.round((count / ratings.total) * 100) : 0);

    host.innerHTML = `
      ${toolbar({
        title: `The last ${ins.window_days} days`,
        description: 'Demand, cancellations and reputation. These are aggregate counts — no rider identities or precise locations leave this screen.',
      })}

      <div class="stat-strip" style="margin-bottom:16px">
        ${statCard({ label: 'Requests', value: String(ins.requests.total), hint: `${ins.requests.completed} completed`, icon: 'ticket', tone: 'blue' })}
        ${statCard({ label: 'Cancellation rate', value: `${ins.requests.cancellation_rate}%`, hint: `${ins.cancellations.total} coded cancellations`, icon: 'ban', tone: ins.requests.cancellation_rate > 20 ? 'red' : 'green' })}
        ${statCard({ label: 'No driver found', value: String(ins.requests.no_driver_found), hint: `${ins.cancellations.redispatched} re-dispatches`, icon: 'navigation', tone: ins.requests.no_driver_found ? 'amber' : 'green' })}
        ${statCard({ label: 'Avg rating', value: ratings.average == null ? '—' : `${Number(ratings.average).toFixed(1)} ★`, hint: `${ratings.total} rider ratings`, icon: 'star', tone: 'amber' })}
        ${statCard({ label: 'Arrival delay', value: ins.punctuality.average_delay_min == null ? '—' : `${ins.punctuality.average_delay_min > 0 ? '+' : ''}${ins.punctuality.average_delay_min} min`, hint: `${ins.punctuality.sample} measured arrivals`, icon: 'clock', tone: 'violet' })}
        ${statCard({ label: 'Peak hour', value: ins.demand.peak_hour == null ? '—' : hourLabel(ins.demand.peak_hour), hint: 'Highest request volume', icon: 'trending-up', tone: 'blue' })}
      </div>

      <section class="panel admin-panel">
        ${sectionHead('Why trips are cancelled', {
          description: `${ins.cancellations.total} coded events · rider ${blame.rider || 0} · driver ${blame.driver || 0} · platform ${blame.platform || 0} · none ${blame.none || 0}`,
        })}
        ${tableBlock(
          '<th>Reason</th><th>Reported by</th><th>Blame</th><th class="num">Count</th><th class="num">Share</th>',
          ins.cancellations.by_reason.map((row) => `<tr>
            <td><strong>${esc(titleCase(row.code))}</strong></td>
            <td>${pill(titleCase(row.role), row.role === 'driver' ? 'amber' : row.role === 'system' ? 'muted' : 'blue')}</td>
            <td>${pill(titleCase(row.blame), row.blame === 'driver' || row.blame === 'rider' ? 'red' : row.blame === 'platform' ? 'amber' : 'muted')}</td>
            <td class="num">${row.count}</td>
            <td class="num">${row.share}%</td>
          </tr>`).join(''),
          { icon: 'ban', title: 'No cancellations', text: 'No coded cancellations in this window.' },
        )}
      </section>

      <section class="panel admin-panel">
        ${sectionHead('Ratings and service quality', {
          description: `${ratings.total} rider ratings · ${ratings.riders_rated} riders rated by drivers · rider average ${ratings.rider_average == null ? '—' : `${ratings.rider_average} ★`}`,
        })}
        <div class="insight-split">
          <div>
            <h3 class="insight-subhead">Star distribution</h3>
            <div class="insight-bars">
              ${ratings.distribution.map((row) => `
                <div class="insight-bar-row">
                  <span class="insight-bar-label">${row.stars} ★</span>
                  <div class="mini-bar"><i style="width:${row.count ? Math.max(4, Math.round((row.count / maxStars) * 100)) : 0}%"></i></div>
                  <span class="insight-bar-value">${row.count} <small>${share(row.count)}%</small></span>
                </div>
              `).join('')}
            </div>
            <h3 class="insight-subhead">Most common tags</h3>
            <div class="tag-chips">
              ${ratings.tags.length
                ? ratings.tags.map((tag) => `<span class="tag-chip is-on">${esc(titleCase(tag.code))} · ${tag.count}</span>`).join('')
                : '<span class="text-muted">No tags yet.</span>'}
            </div>
          </div>
          <div>
            <h3 class="insight-subhead">Aspect averages</h3>
            <div class="insight-bars">
              ${ratings.aspects.map((aspect) => `
                <div class="insight-bar-row">
                  <span class="insight-bar-label">${esc(ASPECT_LABELS[aspect.key] || titleCase(aspect.key))}</span>
                  <div class="mini-bar"><i style="width:${aspect.avg == null ? 0 : Math.round((aspect.avg / 5) * 100)}%"></i></div>
                  <span class="insight-bar-value">${aspect.avg == null ? '—' : `${aspect.avg.toFixed(1)}`}</span>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      </section>

      <section class="panel admin-panel">
        ${sectionHead('Where the demand is', {
          description: `Requests grouped into ~1.2 km geohash cells · peak hour ${ins.demand.peak_hour == null ? '—' : hourLabel(ins.demand.peak_hour)} · ${ins.demand.online_supply} drivers online now.`,
        })}
        <div class="demand-heatmap" aria-label="Request density by area">
          ${ins.demand.heatmap.length
            ? ins.demand.heatmap.map((cell) => {
              const max = Math.max(1, ...ins.demand.heatmap.map((row) => row.requests));
              const intensity = Math.max(0.15, cell.requests / max);
              return `<div class="demand-cell" style="--heat:${intensity.toFixed(2)}">
                <strong>${cell.requests}</strong>
                <small>${cell.online_drivers} online</small>
                ${cell.surge > 1 ? `<span class="demand-surge">×${cell.surge}</span>` : ''}
              </div>`;
            }).join('')
            : '<p class="text-muted">No pickups in this window yet.</p>'}
        </div>
        ${tableBlock(
          '<th>Pickup cell</th><th>Sample pickup</th><th class="num">Requests</th><th class="num">Online now</th><th class="num">Pressure</th><th class="num">Surge hint</th>',
          ins.demand.areas.map((area) => `<tr>
            <td class="nowrap"><strong>${area.lat.toFixed(2)}, ${area.lng.toFixed(2)}</strong></td>
            <td>${esc(area.sample || '—')}</td>
            <td class="num">${area.requests}</td>
            <td class="num">${area.online_drivers ?? 0}</td>
            <td class="num">${area.pressure ?? '—'}</td>
            <td class="num">${area.surge > 1 ? pill(`×${area.surge}`, 'amber') : pill('×1', 'muted')}</td>
          </tr>`).join(''),
          { icon: 'map', title: 'No demand data', text: 'Pickup areas appear once rides are requested.' },
        )}
        ${ins.demand.surge_suggestions.length
          ? `<p class="fine-print">${icon('info', 13)} Surge is an operations suggestion only — AddisGo never changes a price automatically. ${ins.demand.surge_suggestions.length} cells are under pressure right now.</p>`
          : ''}
      </section>

      <section class="panel admin-panel">
        ${sectionHead('Driver air-time', {
          description: `${ins.fleet.online_now} online now · ${ins.fleet.sessions} sessions · ${ins.fleet.app_closed_share}% ended because the app was closed.`,
        })}
        <div class="stat-strip" style="margin-bottom:16px">
          ${statCard({ label: 'Online hours', value: minutes(ins.fleet.online_minutes), hint: `${plural(ins.fleet.sessions, 'session')} in window`, icon: 'clock', tone: 'blue' })}
          ${statCard({ label: 'Idle time', value: minutes(ins.fleet.idle_minutes), hint: 'Online but no trip', icon: 'navigation', tone: 'violet' })}
          ${statCard({ label: 'Avg session', value: minutes(ins.fleet.avg_session_minutes), hint: `${minutes(ins.fleet.avg_idle_minutes)} idle per session`, icon: 'trending-up', tone: 'amber' })}
          ${statCard({ label: 'Acceptance', value: ins.fleet.acceptance_rate == null ? '—' : `${ins.fleet.acceptance_rate}%`, hint: `${ins.fleet.accepted_offers} accepted · ${ins.fleet.declined_offers} declined`, icon: 'check-circle', tone: 'green' })}
          ${statCard({ label: 'App closed', value: String(ins.fleet.app_closed_sessions), hint: 'Sessions ended by silence', icon: 'smartphone', tone: ins.fleet.app_closed_sessions ? 'red' : 'green' })}
          ${statCard({ label: 'Offers sent', value: String(ins.fleet.offers), hint: 'Dispatch attempts in window', icon: 'send', tone: 'blue' })}
        </div>
        ${tableBlock(
          '<th>Driver</th><th class="num">Online</th><th class="num">Idle</th><th class="num">Sessions</th><th class="num">Acceptance</th><th>Last beat</th>',
          ins.fleet.drivers.map((driver) => `<tr>
            <td><strong>${esc(driver.name)}</strong>${driver.is_online ? ' ' + pill('Online', 'green') : ''}</td>
            <td class="num">${minutes(driver.online_minutes)}</td>
            <td class="num">${minutes(driver.idle_minutes)}</td>
            <td class="num">${driver.sessions}</td>
            <td class="num">${driver.acceptance_rate == null ? '—' : `${driver.acceptance_rate}%`}</td>
            <td class="nowrap">${driver.last_heartbeat ? esc(relative(driver.last_heartbeat)) : '—'}</td>
          </tr>`).join(''),
          { icon: 'clock', title: 'No sessions yet', text: 'Air-time appears once drivers go online.' },
        )}
      </section>

      <section class="panel admin-panel">
        ${sectionHead('Who rides with us', {
          description: `${ins.demographics.new_users} new accounts in this window · ${ins.demographics.avg_rides_per_rider} completed rides per active rider.`,
        })}
        <div class="insight-split">
          <div>
            <h3 class="insight-subhead">Accounts by role</h3>
            <div class="insight-bars">
              ${Object.entries(ins.demographics.roles).map(([role, count]) => `
                <div class="insight-bar-row">
                  <span class="insight-bar-label">${esc(roleLabel(role))}</span>
                  <div class="mini-bar"><i style="width:${Math.max(2, Math.round((count / Math.max(1, ins.demographics.roles.customer + ins.demographics.roles.driver + ins.demographics.roles.admin)) * 100))}%"></i></div>
                  <span class="insight-bar-value">${count}</span>
                </div>
              `).join('')}
            </div>
            <h3 class="insight-subhead">Request frequency</h3>
            <div class="insight-bars">
              ${ins.demographics.frequency.map((row) => `
                <div class="insight-bar-row">
                  <span class="insight-bar-label">${esc(row.bucket === 'once' ? 'One ride' : `${row.bucket} rides`)}</span>
                  <div class="mini-bar"><i style="width:${Math.max(2, Math.round((row.riders / Math.max(1, ins.demographics.riders_with_trips)) * 100))}%"></i></div>
                  <span class="insight-bar-value">${row.riders} <small>riders</small></span>
                </div>
              `).join('')}
            </div>
          </div>
          <div>
            <h3 class="insight-subhead">Rider languages</h3>
            <div class="insight-bars">
              ${ins.demographics.languages.length
                ? ins.demographics.languages.map((row) => `
                  <div class="insight-bar-row">
                    <span class="insight-bar-label">${esc(row.name)}</span>
                    <div class="mini-bar"><i style="width:${Math.max(2, Math.round((row.count / Math.max(1, ins.demographics.languages[0].count)) * 100))}%"></i></div>
                    <span class="insight-bar-value">${row.count}</span>
                  </div>
                `).join('')
                : '<p class="text-muted">No rider profiles yet.</p>'}
            </div>
            <h3 class="insight-subhead">Verification</h3>
            <div class="insight-bars">
              <div class="insight-bar-row">
                <span class="insight-bar-label">Verified riders</span>
                <div class="mini-bar"><i style="width:${Math.max(2, Math.round((ins.demographics.verified_riders / Math.max(1, ins.demographics.roles.customer)) * 100))}%"></i></div>
                <span class="insight-bar-value">${ins.demographics.verified_riders} <small>of ${ins.demographics.roles.customer}</small></span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section class="panel admin-panel">
        ${sectionHead('Fleet and riders', { description: 'Highest rated drivers and the most frequent riders in this window.' })}
        <div class="insight-split">
          <div>
            <h3 class="insight-subhead">Top drivers</h3>
            ${tableBlock(
              '<th>Driver</th><th>Class</th><th class="num">Rating</th><th class="num">Trips</th>',
              ins.top_drivers.map((driver) => `<tr>
                <td><strong>${esc(driver.name)}</strong>${driver.is_online ? ' ' + pill('Online', 'green') : ''}</td>
                <td>${esc(vehicleClass(driver.vehicle_class).name)}</td>
                <td class="num">${driver.rating.toFixed(1)} ★ <small>(${driver.rating_count})</small></td>
                <td class="num">${driver.trips}</td>
              </tr>`).join(''),
              { icon: 'car', title: 'No drivers', text: 'Approved drivers appear here.' },
            )}
          </div>
          <div>
            <h3 class="insight-subhead">Most active riders</h3>
            ${tableBlock(
              '<th>Rider</th><th class="num">Completed</th><th class="num">Reputation</th>',
              ins.top_riders.map((rider) => `<tr>
                <td><strong>${esc(rider.name)}</strong></td>
                <td class="num">${rider.trips}</td>
                <td class="num">${rider.rating.toFixed(1)} ★ <small>(${rider.rating_count})</small></td>
              </tr>`).join(''),
              { icon: 'users', title: 'No riders', text: 'Riders appear once they book.' },
            )}
          </div>
        </div>
      </section>
    `;
  };

  /* ---------------------------------------------------------------- */
  /* Drivers                                                           */
  /* ---------------------------------------------------------------- */

  const currentDrivers = () => data.drivers.filter((driver) => {
    if (filters.drivers !== 'all' && driver.status !== filters.drivers) return false;
    if (!queries.drivers) return true;
    const haystack = `${driver.name} ${driver.email} ${driver.phone || ''} ${driver.plate} ${driver.make_model}`.toLowerCase();
    return haystack.includes(queries.drivers);
  });

  const paintDrivers = () => {
    const host = bodyFor('drivers');
    if (!host) return;
    if (!loaded.has('drivers')) {
      host.innerHTML = skeletons(4, 'line-skeleton');
      return;
    }
    const rows = currentDrivers();
    const counts = { all: data.drivers.length, pending: 0, approved: 0, suspended: 0 };
    data.drivers.forEach((driver) => { counts[driver.status] = (counts[driver.status] || 0) + 1; });

    host.innerHTML = `
      ${toolbar({
        title: 'Drivers',
        description: `${plural(counts.approved, 'approved driver')} · ${counts.pending} in review · ${counts.suspended} suspended.`,
        actions: `<button type="button" class="btn btn-primary btn-sm" data-add-driver>${icon('plus', 15)} Add driver</button>`,
      })}
      ${filterBar({
        tabs: DRIVER_FILTERS.map((key) => `<button type="button" class="tab ${filters.drivers === key ? 'is-active' : ''}" role="tab"
          data-driver-filter="${key}" aria-selected="${filters.drivers === key}">
          ${esc(key === 'all' ? 'All' : titleCase(key))} <span class="tab-count">${counts[key] || 0}</span>
        </button>`).join(''),
        search: searchBox('driver-search', 'Name, email or plate', queries.drivers),
      })}
      ${tableBlock(
        '<th>Driver</th><th>Vehicle</th><th>Rating</th><th class="num">Trips</th><th>Status</th><th>Applied</th><th class="actions-col">Actions</th>',
        rows.map((driver) => `<tr class="${driver.status === 'pending' ? 'is-highlight' : ''}">
          <td><div class="table-person">${avatar(driver, 34)}<span><strong>${esc(driver.name)}</strong><small>${esc(driver.email)}</small><small>${esc(driver.phone || 'No phone')}</small></span></div></td>
          <td><span class="table-vehicle">
            <span class="badge badge-soft tone-${vehicleClass(driver.vehicle_class).tone}">${esc(vehicleClass(driver.vehicle_class).name)}</span>
            <small>${esc(driver.make_model)} · <span class="plate">${esc(driver.plate)}</span></small>
            <small>${esc(driver.color || 'Colour not set')} · Licence ${esc(driver.license_no)}</small>
          </span></td>
          <td>${stars(driver.rating, { count: driver.rating_count })}</td>
          <td class="num">${esc(String(driver.trips))}</td>
          <td>${statusBadge(driver.status)}${driver.user_status !== 'active' ? `<small class="block-note">Account ${esc(driver.user_status)}</small>` : ''}</td>
          <td class="nowrap">${esc(date(driver.created_at))}</td>
          <td class="actions-col">${rowActions(
            actionBtn('Edit', 'edit', `data-driver-edit="${driver.id}"`),
            driver.status !== 'approved' ? actionBtn('Approve', 'check', `data-driver-status="approved" data-driver-id="${driver.id}"`, 'btn-primary') : '',
            driver.status !== 'suspended' ? actionBtn('Suspend', 'ban', `data-driver-status="suspended" data-driver-id="${driver.id}"`, 'btn-ghost btn-danger-text') : '',
            driver.status !== 'pending' ? actionBtn('Review', 'clock', `data-driver-status="pending" data-driver-id="${driver.id}"`) : '',
            actionBtn('Delete', 'trash', `data-driver-delete="${driver.id}"`, 'btn-ghost btn-danger-text'),
          )}</td>
        </tr>`).join(''),
        {
          icon: 'filter',
          title: 'No drivers match this view',
          text: 'Clear the search or pick another status to see more applications.',
          action: '<button type="button" class="btn btn-sm btn-ghost" data-driver-filter="all">Show all drivers</button>',
        },
      )}
    `;
  };

  /* ---------------------------------------------------------------- */
  /* People                                                            */
  /* ---------------------------------------------------------------- */

  const paintUsers = () => {
    const host = bodyFor('users');
    if (!host) return;
    if (!loaded.has('users')) {
      host.innerHTML = skeletons(4, 'line-skeleton');
      return;
    }
    host.innerHTML = `
      ${toolbar({
        title: 'People',
        description: `${plural(data.users.length, 'account')} in this view. Create riders or driver accounts, verify people, suspend access or remove empty accounts.`,
        actions: `<button type="button" class="btn btn-primary btn-sm" data-add-user>${icon('plus', 15)} Add person</button>`,
      })}
      ${filterBar({
        tabs: ROLE_FILTERS.map((key) => `<button type="button" class="tab ${filters.users === key ? 'is-active' : ''}" role="tab"
          data-role-filter="${key}" aria-selected="${filters.users === key}">
          ${esc(key === 'all' ? 'Everyone' : roleLabel(key))}
        </button>`).join(''),
        search: searchBox('user-search', 'Search name, email or phone', queries.users),
      })}
      ${tableBlock(
        '<th>Person</th><th>Role</th><th>Status</th><th>Verified</th><th class="num">Rides</th><th>Joined</th><th class="actions-col">Actions</th>',
        data.users.map((user) => {
          const self = user.id === selfId;
          const protectedRow = self || user.role === 'admin';
          return `<tr class="${protectedRow ? 'is-muted-row' : ''}">
            <td><div class="table-person">${avatar(user, 34)}<span><strong>${esc(user.name)}${self ? ' <em class="host-tag">You</em>' : ''}</strong><small>${esc(user.email)}</small><small>${esc(user.phone || 'No phone')}</small></span></div></td>
            <td><span class="badge badge-muted">${esc(roleLabel(user.role))}</span>${user.driver_status ? `<small class="block-note">Driver ${esc(user.driver_status)}</small>` : ''}</td>
            <td>${statusBadge(user.status)}</td>
            <td>${user.is_verified ? `<span class="badge badge-green">${icon('check-circle', 12)} Verified</span>` : `<span class="badge badge-muted">${icon('clock', 12)} Unverified</span>`}</td>
            <td class="num">${esc(String(user.bookings))}</td>
            <td class="nowrap">${esc(date(user.created_at))}</td>
            <td class="actions-col">${protectedRow ? '<span class="muted fine-print">Managed in profile</span>' : rowActions(
              actionBtn('Edit', 'edit', `data-user-edit="${user.id}"`),
              actionBtn(user.is_verified ? 'Unverify' : 'Verify', user.is_verified ? 'ban' : 'check-circle', `data-user-verify="${user.is_verified ? '0' : '1'}" data-user-id="${user.id}"`),
              actionBtn(user.status === 'active' ? 'Suspend' : 'Reactivate', user.status === 'active' ? 'ban' : 'check', `data-user-status="${user.status === 'active' ? 'suspended' : 'active'}" data-user-id="${user.id}"`, user.status === 'active' ? 'btn-ghost btn-danger-text' : 'btn-primary'),
              actionBtn('Delete', 'trash', `data-user-delete="${user.id}"`, 'btn-ghost btn-danger-text'),
            )}</td>
          </tr>`;
        }).join(''),
        { icon: 'users', title: 'Nobody matches this search', text: 'Try a different name, email or phone number.' },
      )}
    `;
  };

  /* ---------------------------------------------------------------- */
  /* Rides                                                             */
  /* ---------------------------------------------------------------- */

  const currentBookings = () => data.bookings.filter((booking) => {
    if (filters.bookings !== 'all' && booking.status !== filters.bookings) return false;
    if (!queries.bookings) return true;
    const haystack = `${booking.code} ${booking.pickup} ${booking.dropoff} ${booking.customer?.name || ''} ${booking.driver?.name || ''}`.toLowerCase();
    return haystack.includes(queries.bookings);
  });

  const paintBookings = () => {
    const host = bodyFor('bookings');
    if (!host) return;
    if (!loaded.has('bookings')) {
      host.innerHTML = skeletons(4, 'line-skeleton');
      return;
    }
    const rows = currentBookings();
    const live = data.bookings.filter((b) => ACTIVE_RIDES.includes(b.status)).length;

    host.innerHTML = `
      ${toolbar({
        title: 'Rides',
        description: `${plural(live, 'live ride')} right now · showing the latest ${plural(data.bookings.length, 'booking')}.`,
        actions: `<span class="badge badge-soft">${icon('navigation', 13)} ${plural(live, 'live ride')}</span>`,
      })}
      ${filterBar({
        tabs: BOOKING_FILTERS.map((key) => `<button type="button" class="tab ${filters.bookings === key ? 'is-active' : ''}" role="tab"
          data-booking-filter="${key}" aria-selected="${filters.bookings === key}">
          ${esc(key === 'all' ? 'All' : titleCase(key))}
        </button>`).join(''),
        search: searchBox('booking-search', 'Code, place or person', queries.bookings),
      })}
      ${tableBlock(
        '<th>Code</th><th>Route</th><th>Rider</th><th>Driver</th><th>Class</th><th>Status</th><th class="num">Fare</th><th>Booked</th><th class="actions-col">Actions</th>',
        rows.map((booking) => `<tr>
          <td><a class="mono-link" href="#/ride/${booking.id}">${esc(booking.code)}</a></td>
          <td class="cell-route">${esc(booking.pickup)} <span class="muted">→</span> ${esc(booking.dropoff)}
            <small>${esc(booking.scheduled_for ? `Scheduled ${dateTime(booking.scheduled_for)}` : `${booking.distance_km} km · ${booking.duration_min} min`)}</small></td>
          <td>${esc(booking.customer?.name || '—')}</td>
          <td>${esc(booking.driver?.name || 'Unmatched')}</td>
          <td><span class="badge badge-soft tone-${vehicleClass(booking.vehicle_class).tone}">${esc(vehicleClass(booking.vehicle_class).short)}</span></td>
          <td>${statusBadge(booking.status)}</td>
          <td class="num">${esc(money(booking.fare))}</td>
          <td class="nowrap">${esc(relative(booking.created_at))}</td>
          <td class="actions-col">${rowActions(
            actionBtn('Edit', 'edit', `data-booking-edit="${booking.id}"`),
            linkBtn('Open', 'eye', `#/ride/${booking.id}`),
            actionBtn('Delete', 'trash', `data-booking-delete="${booking.id}"`, 'btn-ghost btn-danger-text'),
          )}</td>
        </tr>`).join(''),
        { icon: 'ticket', title: 'No rides match this view', text: 'Try another status or clear the search.' },
      )}
    `;
  };

  /* ---------------------------------------------------------------- */
  /* Tours                                                             */
  /* ---------------------------------------------------------------- */

  const currentTours = () => data.tours.filter((tour) => {
    if (filters.tours !== 'all' && tour.status !== filters.tours) return false;
    if (!queries.tours) return true;
    return `${tour.title} ${tour.meeting_point} ${tour.host?.name || ''}`.toLowerCase().includes(queries.tours);
  });

  const paintTours = () => {
    const host = bodyFor('tours');
    if (!host) return;
    if (!loaded.has('tours')) {
      host.innerHTML = skeletons(3, 'tour-skeleton');
      return;
    }
    const rows = currentTours();
    const counts = { all: data.tours.length, upcoming: 0, completed: 0, cancelled: 0 };
    data.tours.forEach((tour) => { counts[tour.status] = (counts[tour.status] || 0) + 1; });

    host.innerHTML = `
      ${toolbar({
        title: 'Tours',
        description: `${plural(counts.upcoming, 'upcoming tour')} · ${counts.completed} completed · ${counts.cancelled} cancelled.`,
        actions: `<button type="button" class="btn btn-primary btn-sm" data-add-tour>${icon('plus', 15)} Add tour</button>`,
      })}
      ${filterBar({
        tabs: TOUR_FILTERS.map((key) => `<button type="button" class="tab ${filters.tours === key ? 'is-active' : ''}" role="tab"
          data-tour-filter="${key}" aria-selected="${filters.tours === key}">
          ${esc(key === 'all' ? 'All' : titleCase(key))} <span class="tab-count">${counts[key] || 0}</span>
        </button>`).join(''),
        search: searchBox('tour-search', 'Title, host or meeting point', queries.tours),
      })}
      ${tableBlock(
        '<th>Tour</th><th>Host</th><th>When</th><th>Group</th><th class="num">Price</th><th>Status</th><th class="actions-col">Actions</th>',
        rows.map((tour) => `<tr>
          <td><div class="table-person">${tour.image_url ? `<img src="${esc(tour.image_url)}" class="table-thumb" alt="" />` : `<span class="table-flag theme-${esc(tour.theme || 'custom')}">${icon('compass', 16)}</span>`}<span><strong>${esc(tour.title)}</strong><small>${esc(tour.meeting_point)}</small><small>${esc(tour.description.slice(0, 70))}${tour.description.length > 70 ? '…' : ''}</small></span></div></td>
          <td><div class="table-person">${avatar(tour.host, 30)}<span><strong>${esc(tour.host.name)}</strong><small>${esc(roleLabel(tour.host.role))}</small></span></div></td>
          <td class="nowrap"><strong>${esc(date(tour.starts_at))}</strong><small class="block-note">${esc(dateTime(tour.starts_at).split('·')[1] || '')} · ${esc(minutes(tour.duration_min))}</small></td>
          <td class="nowrap">${tour.member_count} / ${tour.capacity}<small class="block-note">${tour.spots_left} spot${tour.spots_left === 1 ? '' : 's'} left</small></td>
          <td class="num">${esc(tour.price ? money(tour.price) : 'Free')}</td>
          <td>${statusBadge(tour.status)}</td>
          <td class="actions-col">${rowActions(
            actionBtn('Edit', 'edit', `data-tour-edit="${tour.id}"`),
            linkBtn('Open', 'eye', `#/tour/${tour.id}`),
            tour.status === 'upcoming' ? actionBtn('Cancel', 'ban', `data-tour-cancel="${tour.id}"`, 'btn-ghost btn-danger-text') : '',
            actionBtn('Delete', 'trash', `data-tour-delete="${tour.id}"`, 'btn-ghost btn-danger-text'),
          )}</td>
        </tr>`).join(''),
        {
          icon: 'compass',
          title: 'No tours match this view',
          text: 'Create a tour to fill the city calendar, or clear the filters.',
          action: '<button type="button" class="btn btn-sm btn-primary" data-add-tour>Add tour</button>',
        },
      )}
    `;
  };

  /* ---------------------------------------------------------------- */
  /* Events                                                            */
  /* ---------------------------------------------------------------- */

  const currentEvents = () => data.events.filter((event) => {
    if (filters.events !== 'all' && event.status !== filters.events) return false;
    if (!queries.events) return true;
    return `${event.title} ${event.venue} ${event.category}`.toLowerCase().includes(queries.events);
  });

  const paintEvents = () => {
    const host = bodyFor('events');
    if (!host) return;
    if (!loaded.has('events')) {
      host.innerHTML = skeletons(4, 'line-skeleton');
      return;
    }
    const rows = currentEvents();
    const counts = { all: data.events.length, published: 0, draft: 0, cancelled: 0 };
    data.events.forEach((event) => { counts[event.status] = (counts[event.status] || 0) + 1; });

    host.innerHTML = `
      ${toolbar({
        title: 'Events',
        description: `${plural(counts.published, 'published event')} · ${counts.draft} drafts · ${counts.cancelled} cancelled. Add what is happening across the city.`,
        actions: `<button type="button" class="btn btn-primary btn-sm" data-add-event>${icon('plus', 15)} Add event</button>`,
      })}
      ${filterBar({
        tabs: EVENT_FILTERS.map((key) => `<button type="button" class="tab ${filters.events === key ? 'is-active' : ''}" role="tab"
          data-event-filter="${key}" aria-selected="${filters.events === key}">
          ${esc(key === 'all' ? 'All' : titleCase(key))} <span class="tab-count">${counts[key] || 0}</span>
        </button>`).join(''),
        search: searchBox('event-search', 'Title, venue or category', queries.events),
      })}
      ${tableBlock(
        '<th>Event</th><th>Venue</th><th>When</th><th>Category</th><th class="num">Ticket</th><th>Status</th><th class="actions-col">Actions</th>',
        rows.map((event) => `<tr>
          <td><div class="table-person">${event.image_url ? `<img src="${esc(event.image_url)}" class="table-thumb" alt="" />` : `<span class="table-flag category-${esc(event.category)}">${icon('calendar', 16)}</span>`}<span><strong>${esc(event.title)}</strong><small>${esc(event.description.slice(0, 80))}${event.description.length > 80 ? '…' : ''}</small></span></div></td>
          <td class="cell-route">${esc(event.venue || 'Venue to be confirmed')}</td>
          <td class="nowrap"><strong>${esc(date(event.starts_at))}</strong><small class="block-note">${esc(dateTime(event.starts_at).split('·')[1] || '')}</small></td>
          <td>${pill(titleCase(event.category), 'soft')}</td>
          <td class="num">${esc(event.price ? money(event.price) : 'Free')}</td>
          <td>${event.status === 'published' ? pill('Published', 'green') : event.status === 'draft' ? pill('Draft', 'amber') : pill('Cancelled', 'red')}</td>
          <td class="actions-col">${rowActions(
            actionBtn('Edit', 'edit', `data-event-edit="${event.id}"`),
            actionBtn(event.status === 'published' ? 'Unpublish' : 'Publish', event.status === 'published' ? 'eye' : 'check', `data-event-status="${event.status === 'published' ? 'draft' : 'published'}" data-event-id="${event.id}"`, event.status === 'published' ? '' : 'btn-primary'),
            actionBtn('Delete', 'trash', `data-event-delete="${event.id}"`, 'btn-ghost btn-danger-text'),
          )}</td>
        </tr>`).join(''),
        {
          icon: 'calendar',
          title: 'No events match this view',
          text: 'Add a jazz night, food walk or market to the city guide.',
          action: '<button type="button" class="btn btn-sm btn-primary" data-add-event>Add event</button>',
        },
      )}
    `;
  };

  /* ---------------------------------------------------------------- */
  /* Routes                                                            */
  /* ---------------------------------------------------------------- */

  const currentRoutes = () => data.routes.filter((route) => {
    if (filters.routes !== 'all' && route.status !== filters.routes) return false;
    if (!queries.routes) return true;
    return `${route.name} ${route.start_point} ${route.end_point}`.toLowerCase().includes(queries.routes);
  });

  const paintRoutes = () => {
    const host = bodyFor('routes');
    if (!host) return;
    if (!loaded.has('routes')) {
      host.innerHTML = skeletons(4, 'line-skeleton');
      return;
    }
    const rows = currentRoutes();
    const counts = { all: data.routes.length, active: 0, inactive: 0 };
    data.routes.forEach((route) => { counts[route.status] = (counts[route.status] || 0) + 1; });

    host.innerHTML = `
      ${toolbar({
        title: 'City routes',
        description: `${plural(counts.active, 'active route')} · ${counts.inactive} hidden. Curated fixed-fare journeys shown to riders.`,
        actions: `<button type="button" class="btn btn-primary btn-sm" data-add-route>${icon('plus', 15)} Add route</button>`,
      })}
      ${filterBar({
        tabs: ROUTE_FILTERS.map((key) => `<button type="button" class="tab ${filters.routes === key ? 'is-active' : ''}" role="tab"
          data-route-filter="${key}" aria-selected="${filters.routes === key}">
          ${esc(key === 'all' ? 'All' : titleCase(key))} <span class="tab-count">${counts[key] || 0}</span>
        </button>`).join(''),
        search: searchBox('route-search', 'Name or stop', queries.routes),
      })}
      ${tableBlock(
        '<th>Route</th><th>Journey</th><th class="num">Distance</th><th class="num">Duration</th><th>Class</th><th class="num">Fare</th><th>Status</th><th class="actions-col">Actions</th>',
        rows.map((route) => `<tr>
          <td><div class="table-person"><span class="table-flag">${icon('map', 16)}</span><span><strong>${esc(route.name)}</strong><small>${esc(route.description.slice(0, 70))}${route.description.length > 70 ? '…' : ''}</small></span></div></td>
          <td class="cell-route">${esc(route.start_point)} <span class="muted">→</span> ${esc(route.end_point)}</td>
          <td class="num">${esc(km(route.distance_km))}</td>
          <td class="num nowrap">${esc(minutes(route.duration_min))}</td>
          <td><span class="badge badge-soft tone-${vehicleClass(route.vehicle_class).tone}">${esc(vehicleClass(route.vehicle_class).short)}</span></td>
          <td class="num">${esc(money(route.fare))}</td>
          <td>${route.status === 'active' ? pill('Active', 'green') : pill('Hidden', 'muted')}</td>
          <td class="actions-col">${rowActions(
            actionBtn('Edit', 'edit', `data-route-edit="${route.id}"`),
            actionBtn(route.status === 'active' ? 'Hide' : 'Activate', route.status === 'active' ? 'eye' : 'check', `data-route-status="${route.status === 'active' ? 'inactive' : 'active'}" data-route-id="${route.id}"`, route.status === 'active' ? '' : 'btn-primary'),
            actionBtn('Delete', 'trash', `data-route-delete="${route.id}"`, 'btn-ghost btn-danger-text'),
          )}</td>
        </tr>`).join(''),
        {
          icon: 'map',
          title: 'No routes match this view',
          text: 'Add a fixed-fare airport run or a cross-town express.',
          action: '<button type="button" class="btn btn-sm btn-primary" data-add-route>Add route</button>',
        },
      )}
    `;
  };

  /* ---------------------------------------------------------------- */
  /* Fares                                                             */
  /* ---------------------------------------------------------------- */

  const sampleFare = (fare) => {
    const duration = Math.max(Math.round((5 / 24) * 60 + 3), 5);
    return Math.round(Math.max(fare.base + fare.per_km * 5 + fare.per_min * duration, fare.minimum) / 5) * 5;
  };

  const paintFares = () => {
    const host = bodyFor('fares');
    if (!host) return;
    if (!loaded.has('fares')) {
      host.innerHTML = skeletons(4, 'line-skeleton');
      return;
    }

    host.innerHTML = `
      ${toolbar({
        title: 'Ride fares',
        description: 'These values price every new estimate and booking. Changes take effect immediately — no restart needed.',
        actions: `<span class="badge badge-soft">${icon('wallet', 13)} ${plural(data.fares.length, 'ride class', 'ride classes')}</span>`,
      })}
      <div class="admin-note">${icon('info', 16)} <span>The rider app charges <strong>base + per km × distance + per minute × duration</strong>, then rounds up to the nearest 5 ETB and never goes below the minimum.</span></div>
      ${tableBlock(
        '<th>Ride class</th><th class="num">Base</th><th class="num">Per km</th><th class="num">Per min</th><th class="num">Minimum</th><th class="num">Seats</th><th class="num">Est. 5 km</th><th>Status</th><th>Updated</th><th class="actions-col">Actions</th>',
        data.fares.map((fare) => `<tr>
          <td><div class="table-person"><span class="table-flag tone-${vehicleClass(fare.key).tone}">${icon('car', 16)}</span><span><strong>${esc(fare.label)}</strong><small>${esc(vehicleClass(fare.key).blurb)}</small></span></div></td>
          <td class="num">${esc(money(fare.base))}</td>
          <td class="num">${esc(money(fare.per_km))}</td>
          <td class="num">${esc(money(fare.per_min))}</td>
          <td class="num">${esc(money(fare.minimum))}</td>
          <td class="num">${fare.seats}</td>
          <td class="num">${esc(money(sampleFare(fare)))}</td>
          <td>${fare.is_active ? pill('Active', 'green') : pill('Disabled', 'red')}</td>
          <td class="nowrap">${esc(relative(fare.updated_at))}</td>
          <td class="actions-col">${rowActions(actionBtn('Adjust', 'edit', `data-fare-edit="${fare.key}"`))}</td>
        </tr>`).join(''),
        { icon: 'wallet', title: 'No fare classes', text: 'Restart the server to seed the standard ride classes.' },
        'data-table-fares',
      )}
    `;
  };

  /* ---------------------------------------------------------------- */
  /* Safety                                                            */
  /* ---------------------------------------------------------------- */

  const paintReports = () => {
    const host = bodyFor('safety');
    if (!host) return;
    if (!loaded.has('safety')) {
      host.innerHTML = skeletons(3, 'line-skeleton');
      return;
    }

    host.innerHTML = `
      ${toolbar({
        title: 'Safety desk',
        description: 'Every report filed from a ride, tour or the safety centre. Resolve, dismiss or delete after review.',
        actions: `<span class="badge badge-soft">${icon('shield', 13)} ${plural(data.reports.length, 'report')}</span>`,
      })}
      ${filterBar({
        tabs: REPORT_FILTERS.map((key) => `<button type="button" class="tab ${filters.reports === key ? 'is-active' : ''}" role="tab"
          data-report-filter="${key}" aria-selected="${filters.reports === key}">
          ${esc(titleCase(key))}
        </button>`).join(''),
      })}
      ${tableBlock(
        '<th>Target</th><th>Reported by</th><th>Reason</th><th>Status</th><th>Filed</th><th class="actions-col">Actions</th>',
        data.reports.map((report) => `<tr class="${report.status === 'open' ? 'is-highlight' : ''}">
          <td><span class="badge badge-soft">${icon(report.target_type === 'tour' ? 'compass' : 'car', 13)} ${esc(titleCase(report.target_type))} #${esc(String(report.target_id))}</span></td>
          <td><div class="table-person">${avatar({ name: report.reporter_name, avatar_color: '#3b6ea5' }, 30)}<span><strong>${esc(report.reporter_name)}</strong><small>${esc(report.reporter_email)}</small></span></div></td>
          <td class="cell-route"><strong>${esc(report.reason)}</strong>${report.detail ? `<small>${esc(report.detail)}</small>` : ''}</td>
          <td>${statusBadge(report.status)}</td>
          <td class="nowrap"><strong>${esc(relative(report.created_at))}</strong>${report.resolved_at ? `<small class="block-note">Closed ${esc(relative(report.resolved_at))}</small>` : ''}</td>
          <td class="actions-col">${rowActions(
            linkBtn('Open', 'arrow-up-right', report.target_type === 'tour' ? `#/tour/${report.target_id}` : `#/ride/${report.target_id}`),
            report.status === 'open' ? actionBtn('Resolve', 'check', `data-report-action="resolved" data-report-id="${report.id}"`, 'btn-primary') : '',
            report.status === 'open' ? actionBtn('Dismiss', 'minus', `data-report-action="dismissed" data-report-id="${report.id}"`) : '',
            actionBtn('Delete', 'trash', `data-report-delete="${report.id}"`, 'btn-ghost btn-danger-text'),
          )}</td>
        </tr>`).join(''),
        {
          icon: 'shield',
          title: filters.reports === 'open' ? 'No open reports' : 'Nothing in this view',
          text: filters.reports === 'open'
            ? 'Riders and hosts can report an issue from their trips, tours and safety centre.'
            : 'Try another status to see earlier reports.',
        },
      )}
    `;
  };

  /* ---------------------------------------------------------------- */
  /* Email & Google                                                    */
  /* ---------------------------------------------------------------- */

  const outboxStatusPill = (message) => {
    const status = String(message.status || '');
    const attempts = Number(message.attempts || 0);
    if (status === 'sent') return pill('Sent', 'green');
    if (status === 'logged_offline') return pill('Logged offline', 'amber');
    if (status === 'sending') return `${pill('Sending', 'amber')} <small class="text-muted">${plural(attempts, 'attempt')}</small>`;
    if (status === 'queued') return `${pill('Queued', 'amber')} <small class="text-muted">${plural(attempts, 'attempt')}</small>`;
    if (status === 'failed') return `${pill('Failed', 'red')} <small class="text-muted">${plural(attempts, 'attempt')}</small>`;
    return pill(titleCase(status), 'soft');
  };

  const paintEmail = () => {
    const host = bodyFor('email');
    if (!host) return;
    if (!loaded.has('email')) {
      host.innerHTML = skeletons(4, 'line-skeleton');
      return;
    }

    const { config, total_sent, subscriber_count, outbox, queue } = data.email || {};
    const cfg = config || {};
    const isReady = Boolean(cfg.is_configured);
    const isVerified = Boolean(cfg.verified_at);
    const tone = isReady ? (isVerified ? 'success' : 'amber') : 'amber';
    const statusLabel = isReady ? (isVerified ? 'Gmail connected' : 'Saved — verify now') : 'Offline logger';
    const statusIcon = isReady ? (isVerified ? 'check-circle' : 'info') : 'alert';
    const isGmail = cfg.gmail ?? /@(gmail|googlemail)\.com$/i.test(cfg.user || '');
    const senderPlaceholder = cfg.user ? `AddisGo <${cfg.user}>` : 'AddisGo <yourname@gmail.com>';

    host.innerHTML = `
      ${toolbar({
        title: 'Email & Google',
        description: `Send real welcome emails, ride receipts and tour notices through your Gmail account · ${total_sent || 0} messages · ${subscriber_count || 0} subscribers.`,
        actions: `<span class="badge badge-${tone}">${icon(statusIcon, 13)} ${statusLabel}</span>`,
      })}
      <div class="email-admin-grid">
        <div class="panel email-status-card">
          <div class="email-status-head">
            <span class="badge badge-${tone}">${icon(statusIcon, 13)} ${isReady ? (isVerified ? 'Real delivery is live' : 'Credentials saved, not verified') : 'Dev logger mode'}</span>
            <span class="email-stats-chip">${total_sent || 0} emails · ${subscriber_count || 0} subscribers</span>
          </div>
          <h3>${isReady ? (isVerified ? 'Google Mail delivery is live' : 'One step left: verify your Gmail connection') : 'Connect your Google / Gmail account'}</h3>
          <p class="muted">${isReady
            ? `Connected as <strong>${esc(cfg.user)}</strong>. ${isVerified ? 'Welcome emails, ride receipts and tour notices are delivered automatically.' : 'Run a verification to confirm Google accepts the saved app password.'}`
            : 'Outgoing email is written to <code>data/emails.log</code> until you connect a Gmail account. Follow the three steps below — it takes about two minutes.'}</p>

          <div class="email-connection-grid">
            <div><span>Account</span><strong>${esc(cfg.user || 'Not connected')}</strong></div>
            <div><span>SMTP server</span><strong>${esc(cfg.host)}:${cfg.port}</strong></div>
            <div><span>Last verified</span><strong>${cfg.verified_at ? esc(dateTime(cfg.verified_at)) : 'Never'}</strong></div>
            <div><span>Last test email</span><strong>${cfg.last_test_at ? esc(dateTime(cfg.last_test_at)) : '—'}</strong></div>
          </div>

          ${cfg.last_error ? `
            <div class="email-alert email-alert-error">
              ${icon('alert', 16)}
              <div><strong>Last connection problem</strong><p>${esc(cfg.last_error)}</p></div>
            </div>` : ''}

          ${isReady ? `
            <div class="email-status-actions">
              <button type="button" class="btn btn-outline btn-sm" id="email-verify-existing">${icon('shield', 14)} Verify connection</button>
              <button type="button" class="btn btn-ghost btn-sm btn-danger-text" id="email-disconnect">${icon('trash', 14)} Disconnect Gmail</button>
            </div>` : ''}
        </div>

        <div class="email-two-col">
          <div class="panel email-settings-card">
            <h4>${icon('key', 16)} Connect your Google account</h4>
            <p class="muted">Use a Google <strong>App Password</strong> — your normal Gmail password will not work for SMTP.</p>
            <form id="email-config-form" class="email-config-form">
              <div class="form-group">
                <label for="smtp-user">Gmail address</label>
                <input type="email" id="smtp-user" name="user" value="${esc(cfg.user || '')}" placeholder="yourname@gmail.com" autocomplete="username" required />
              </div>
              <div class="form-group">
                <label for="smtp-pass">Google App Password</label>
                <div class="app-password-field">
                  <input type="password" id="smtp-pass" name="pass" placeholder="${cfg.password_set ? 'Saved — leave blank to keep it' : 'abcd efgh ijkl mnop'}" autocomplete="new-password" spellcheck="false" />
                  <button type="button" class="btn btn-ghost btn-sm app-password-toggle" id="toggle-app-password" aria-label="Show app password">${icon('eye', 16)}</button>
                </div>
                <small class="muted">16 letters from Google. Spaces are fine. ${cfg.password_set ? 'The saved password is hidden.' : ''}</small>
              </div>
              <div class="form-group">
                <label for="smtp-from">Sender name &amp; email</label>
                <input type="text" id="smtp-from" name="from" value="${esc(isReady ? cfg.from : '')}" placeholder="${esc(senderPlaceholder)}" />
                <small class="muted">Leave blank to send as “AddisGo &lt;your Gmail address&gt;”. Gmail may require an alias if you use another address.</small>
              </div>
              <div id="email-verify-result" class="test-email-result"></div>
              <div class="form-actions email-form-actions">
                <button type="submit" class="btn btn-primary" data-email-action="verify">${icon('shield', 14)} Verify &amp; save</button>
                <button type="submit" class="btn btn-outline" data-email-action="save">Save without testing</button>
              </div>
            </form>
          </div>

          <div class="panel email-test-card">
            <h4>${icon('send', 16)} Send a live test email</h4>
            <p class="muted">Dispatch an immediate test to confirm Gmail delivery end to end.</p>
            <form id="email-test-form" class="email-test-form">
              <div class="form-group">
                <label for="test-recipient">Recipient email</label>
                <input type="email" id="test-recipient" placeholder="you@example.com" value="${esc(cfg.user || '')}" required />
              </div>
              <button type="submit" class="btn btn-outline" id="send-test-btn">${icon('mail', 14)} Send test email</button>
              <div id="test-email-result" class="test-email-result"></div>
            </form>

            <div class="google-guide-box">
              <strong>${icon('key', 14)} How to get a Google App Password</strong>
              <ol class="google-guide-steps">
                <li><a href="https://myaccount.google.com/security" target="_blank" rel="noopener">Turn on 2-Step Verification</a> for your Google account.</li>
                <li>Open <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener">Google App Passwords</a>.</li>
                <li>Create one named <strong>AddisGo</strong>, then paste the 16 letters here.</li>
              </ol>
              <p class="google-guide-note">${isGmail ? 'Gmail addresses use <code>smtp.gmail.com</code> on port 465 automatically.' : 'Google Workspace admins may need to allow app passwords first.'}</p>
            </div>
          </div>
        </div>

        <div class="panel email-outbox-panel">
          ${sectionHead('Recent email outbox', { description: `${plural(outbox?.length || 0, 'recent message')} stored by the email service.${queue?.pending ? ` ${queue.pending} queued for retry.` : ''}${queue?.failed ? ` ${queue.failed} permanently failed.` : ''}` })}
          ${tableBlock(
            '<th>Time</th><th>Recipient</th><th>Subject</th><th>Template</th><th>Status</th><th class="actions-col">Actions</th>',
            (outbox || []).map((message) => `<tr>
              <td class="nowrap"><small>${esc(dateTime(message.created_at))}</small></td>
              <td><strong>${esc(message.recipient)}</strong></td>
              <td>${esc(message.subject)}</td>
              <td><span class="badge badge-soft">${esc(message.template)}</span></td>
              <td>${outboxStatusPill(message)}${message.error ? `<br><small class="text-muted">${esc(message.error)}</small>` : ''}${message.next_attempt_at ? `<br><small class="text-muted">Next try ${esc(dateTime(message.next_attempt_at))}</small>` : ''}</td>
              <td class="actions-col">${rowActions(
                ['queued', 'failed', 'sending'].includes(message.status)
                  ? actionBtn('Retry', 'refresh', `data-outbox-retry="${message.id}"`, 'btn-ghost')
                  : '',
                actionBtn('Delete', 'trash', `data-outbox-delete="${message.id}"`, 'btn-ghost btn-danger-text'),
              )}</td>
            </tr>`).join(''),
            { icon: 'mail', title: 'No emails dispatched yet', text: 'When users register, book rides or subscribe, messages appear here.' },
          )}
        </div>

        <div class="panel">
          ${sectionHead('Newsletter subscribers', { description: 'People who asked for city updates from the landing page.' })}
          ${tableBlock(
            '<th>Email</th><th>Source</th><th>Joined</th><th class="actions-col">Actions</th>',
            data.subscribers.map((subscriber) => `<tr>
              <td><strong>${esc(subscriber.email)}</strong></td>
              <td>${pill(titleCase(subscriber.source), 'soft')}</td>
              <td class="nowrap">${esc(date(subscriber.created_at))}</td>
              <td class="actions-col">${rowActions(actionBtn('Remove', 'trash', `data-subscriber-delete="${subscriber.id}"`, 'btn-ghost btn-danger-text'))}</td>
            </tr>`).join(''),
            { icon: 'users', title: 'No subscribers yet', text: 'Newsletter signups from the landing page will be listed here.' },
          )}
        </div>
      </div>
    `;

    host.querySelector('#toggle-app-password')?.addEventListener('click', (event) => {
      const input = host.querySelector('#smtp-pass');
      const button = event.currentTarget;
      if (!input) return;
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      button.setAttribute('aria-label', show ? 'Hide app password' : 'Show app password');
      button.innerHTML = icon(show ? 'eye' : 'lock', 16);
    });

    const describeVerification = (verification) => `
      <div class="email-alert ${verification.ok ? 'email-alert-success' : 'email-alert-error'}">
        ${icon(verification.ok ? 'check-circle' : 'alert', 16)}
        <div>
          <strong>${verification.ok ? 'Google accepted the connection' : 'Google could not connect'}</strong>
          <p>${esc(verification.message)}</p>
          ${!verification.ok && verification.detail ? `<small>${esc(verification.detail)}</small>` : ''}
        </div>
      </div>`;

    host.querySelector('#email-config-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const action = event.submitter?.dataset.emailAction || 'verify';
      const button = event.submitter || host.querySelector('[data-email-action="verify"]');
      const result = host.querySelector('#email-verify-result');
      const payload = {
        user: host.querySelector('#smtp-user').value.trim(),
        pass: host.querySelector('#smtp-pass').value.trim(),
        from: host.querySelector('#smtp-from').value.trim(),
      };

      await withBusy(button, async () => {
        try {
          if (action === 'verify') {
            result.innerHTML = '<span class="text-muted">Saving and contacting Google…</span>';
            const response = await api('/admin/email/settings', { method: 'POST', body: { ...payload, verify: true } });
            const verification = response.verification || { ok: false, message: 'Verification did not run.' };
            result.innerHTML = describeVerification(verification);
            if (verification.ok) toast('Gmail connected and verified.');
            else toastError(new Error(verification.message), 'Gmail verification failed.');
          } else {
            await api('/admin/email/settings', { method: 'POST', body: payload });
            result.innerHTML = `
              <div class="email-alert email-alert-success">
                ${icon('check', 16)}
                <div><strong>Settings saved</strong><p>Run “Verify connection” to confirm Google accepts the sign-in.</p></div>
              </div>`;
            toast('Gmail settings saved.');
          }
          await reloadTab('email');
        } catch (error) {
          result.innerHTML = `
            <div class="email-alert email-alert-error">
              ${icon('alert', 16)}
              <div><strong>Could not save</strong><p>${esc(error.message)}</p></div>
            </div>`;
          toastError(error, 'Failed to save email settings.');
        }
      });
    });

    host.querySelector('#email-verify-existing')?.addEventListener('click', async (event) => {
      const button = event.currentTarget;
      await withBusy(button, async () => {
        try {
          const verification = await api('/admin/email/verify', { method: 'POST', body: {} });
          if (verification.ok) toast('Gmail connection verified.');
          else toastError(new Error(verification.message), 'Gmail verification failed.');
          await reloadTab('email', { quiet: true });
        } catch (error) {
          toastError(error, 'Could not verify the Gmail connection.');
        }
      });
    });

    host.querySelector('#email-disconnect')?.addEventListener('click', async () => {
      const ok = await confirmModal({
        title: 'Disconnect Gmail?',
        message: 'Stored Gmail credentials will be removed and outgoing email will return to the local dev log.',
        confirmLabel: 'Disconnect',
        danger: true,
      });
      if (!ok) return;
      try {
        await api('/admin/email/disconnect', { method: 'POST', body: {} });
        toast('Gmail disconnected. Email will be logged locally.');
        await reloadTab('email');
      } catch (error) {
        toastError(error, 'Could not disconnect Gmail.');
      }
    });

    host.querySelector('#email-test-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const recipient = host.querySelector('#test-recipient').value.trim();
      const result = host.querySelector('#test-email-result');
      const button = host.querySelector('#send-test-btn');
      if (!recipient) return;
      result.innerHTML = '<span class="text-muted">Sending test email…</span>';
      await withBusy(button, async () => {
        try {
          const response = await api('/admin/email/test', { method: 'POST', body: { recipient } });
          if (response.ok && response.method === 'smtp') {
            result.innerHTML = `<div class="email-alert email-alert-success">${icon('check-circle', 16)}<div><strong>Delivered</strong><p>Gmail accepted the message for ${esc(recipient)}.</p></div></div>`;
            toast(`Test email delivered to ${recipient}`);
            await reloadTab('email', { quiet: true });
          } else if (response.ok) {
            result.innerHTML = `<div class="email-alert email-alert-amber">${icon('info', 16)}<div><strong>Saved to the dev log</strong><p>Gmail is not connected, so the message was written to <code>data/emails.log</code> instead of being delivered.</p></div></div>`;
            await reloadTab('email', { quiet: true });
          } else {
            result.innerHTML = `<div class="email-alert email-alert-error">${icon('alert', 16)}<div><strong>Not delivered</strong><p>${esc(response.error || 'Could not send the test email.')}</p>${response.detail ? `<small>${esc(response.detail)}</small>` : ''}</div></div>`;
            toastError(new Error(response.error || 'Send failed'), 'Could not send test email.');
            await reloadTab('email', { quiet: true });
          }
        } catch (error) {
          result.innerHTML = `<div class="email-alert email-alert-error">${icon('alert', 16)}<div><strong>Not delivered</strong><p>${esc(error.message || 'Send failed')}</p></div></div>`;
          toastError(error, 'Could not send test email.');
        }
      });
    });
  };

  /* ---------------------------------------------------------------- */
  /* Website settings                                                  */
  /* ---------------------------------------------------------------- */

  const paintSite = () => {
    const host = bodyFor('site');
    if (!host) return;
    if (!loaded.has('site') || !data.site) {
      host.innerHTML = skeletons(4, 'line-skeleton');
      return;
    }
    const site = data.site;

    host.innerHTML = `
      ${toolbar({
        title: 'Website CRM',
        description: 'Brand, support details and the announcement banner shown across AddisGo.',
        actions: '',
      })}
      <div class="site-admin-grid">
        <form class="panel site-form" id="site-form">
          <div class="form-alert" id="site-error" role="alert" hidden></div>
          <div class="field-grid">
            ${inputField({ label: 'Site name', name: 'site_name', value: site.site_name, max: 60, required: true })}
            ${inputField({ label: 'Support email', name: 'support_email', value: site.support_email, type: 'email', max: 120, required: true })}
            ${inputField({ label: 'Tagline', name: 'tagline', value: site.tagline, max: 140, required: true, wide: true })}
            ${textareaField({ label: 'Footer note', name: 'footer_note', value: site.footer_note, rows: 3, maxLength: 300, hint: 'Shown in the site footer under the brand.' })}
            ${textareaField({ label: 'Announcement', name: 'announcement', value: site.announcement, rows: 2, maxLength: 240, hint: 'Leave blank to hide the banner.' })}
          </div>
          <label class="check-chip site-toggle">
            <input type="checkbox" name="announcement_enabled" value="1" ${site.announcement_enabled ? 'checked' : ''} />
            <span>Show the announcement banner</span>
          </label>
          <div class="form-actions">
            <button type="submit" class="btn btn-primary" id="site-save">${icon('check', 15)} Save website settings</button>
            <span class="muted">Saves to the live site meta store.</span>
          </div>
        </form>

        <aside class="panel site-preview">
          <h2 class="panel-title">Preview</h2>
          <div class="site-preview-card">
            ${site.announcement_enabled && site.announcement ? `<div class="site-preview-banner">${esc(site.announcement)}</div>` : '<div class="site-preview-banner is-empty">No announcement banner</div>'}
            <div class="site-preview-body">
              <span class="site-preview-logo">${icon('navigation', 18)}</span>
              <strong>${esc(site.site_name)}</strong>
              <p>${esc(site.tagline)}</p>
              <small>${esc(site.support_email)}</small>
            </div>
            <div class="site-preview-foot">${esc(site.footer_note)}</div>
          </div>
          <p class="fine-print">${icon('info', 13)} These values are also available at <code>/public/site</code>.</p>
        </aside>
      </div>
    `;

    const form = host.querySelector('#site-form');
    const errorBox = host.querySelector('#site-error');
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      errorBox.hidden = true;
      const body = formObject(new FormData(form));
      body.announcement_enabled = Boolean(form.querySelector('[name="announcement_enabled"]').checked);
      const button = host.querySelector('#site-save');
      await withBusy(button, async () => {
        try {
          data.site = await api('/admin/site', { method: 'POST', body });
          toast('Website settings saved.');
          loaded.delete('site');
          paintSite();
        } catch (error) {
          errorBox.hidden = false;
          errorBox.innerHTML = `${icon('info', 16)} <span>${esc(error.message)}</span>`;
        }
      });
    });
  };

  /* ---------------------------------------------------------------- */
  /* Audit                                                             */
  /* ---------------------------------------------------------------- */

  const paintAudit = () => {
    const host = bodyFor('audit');
    if (!host) return;
    if (!loaded.has('audit')) {
      host.innerHTML = skeletons(4, 'line-skeleton');
      return;
    }
    host.innerHTML = `
      ${toolbar({
        title: 'Audit log',
        description: 'Every sensitive change made by an admin or account owner, newest first.',
        actions: `<span class="badge badge-soft">${icon('flag', 13)} ${plural(data.audit.length, 'entry', 'entries')}</span>`,
      })}
      ${tableBlock(
        '<th style="width:170px">When</th><th style="width:150px">Actor</th><th style="width:170px">Action</th><th>Detail &amp; Metadata</th>',
        data.audit.map((entry) => {
          const act = String(entry.action || '').toLowerCase();
          const actionTone = act.includes('approved') ? 'green'
            : (act.includes('suspended') || act.includes('ban') || act.includes('delete')) ? 'red'
            : act.includes('email') ? 'blue'
            : act.includes('safety') ? 'amber'
            : 'soft';
          return `<tr>
            <td class="nowrap">
              <strong>${esc(relative(entry.created_at))}</strong>
              <small class="block-note">${esc(dateTime(entry.created_at))}</small>
            </td>
            <td class="nowrap">
              <span class="actor-chip">${icon('user', 12)} ${esc(entry.actor_name)}</span>
            </td>
            <td class="nowrap">${pill(titleCase(entry.action), actionTone)}</td>
            <td class="cell-audit-detail"><code>${esc(entry.detail)}</code></td>
          </tr>`;
        }).join(''),
        { icon: 'flag', title: 'No audit entries yet', text: 'Admin changes are recorded here as they happen.' },
        'audit-table'
      )}
    `;
  };

  /* ---------------------------------------------------------------- */
  /* Revenue                                                           */
  /* ---------------------------------------------------------------- */

  const paintRevenue = () => {
    const host = bodyFor('revenue');
    if (!host || !data.revenue) return;
    const rev = data.revenue;
    const cfg = rev.config;
    const totals = rev.totals;
    const splitLabel = cfg.model === 'commission'
      ? `Driver keeps fare − ${cfg.commission_rate}% commission`
      : `Driver keeps fare + ${cfg.incentive_rate}% incentive`;
    const maxDay = Math.max(1, ...rev.daily.map((row) => row.gross));

    host.innerHTML = `
      ${toolbar({
        title: 'Revenue & payouts',
        description: 'One platform-wide model, applied to every completed trip and recorded once in the ledger. The rider always pays the gross fare shown on the receipt.',
      })}

      <section class="panel admin-panel">
        ${sectionHead('Revenue model', { description: splitLabel })}
        <form id="revenue-form" class="field-grid">
          <label class="field">
            <span>Model</span>
            <select name="model" class="field-input">
              <option value="commission" ${cfg.model === 'commission' ? 'selected' : ''}>Commission — platform takes a cut</option>
              <option value="incentive" ${cfg.model === 'incentive' ? 'selected' : ''}>Incentive — platform tops up the driver</option>
            </select>
          </label>
          <label class="field">
            <span>Commission rate (%)</span>
            <input type="number" name="commission_rate" min="0" max="50" step="0.5" value="${esc(String(cfg.commission_rate))}" class="field-input">
          </label>
          <label class="field">
            <span>Incentive rate (%)</span>
            <input type="number" name="incentive_rate" min="0" max="50" step="0.5" value="${esc(String(cfg.incentive_rate))}" class="field-input">
          </label>
          <div class="field field-wide">
            <button type="submit" class="btn btn-primary" data-revenue-save>${icon('wallet', 15)} Save revenue model</button>
          </div>
        </form>
        <p class="fine-print">${icon('info', 13)} Only the active model applies. Changing the model never edits past ledger rows — historical payouts stay exactly as they were settled.</p>
      </section>

      <div class="stat-strip" style="margin-bottom:16px">
        ${statCard({ label: 'Gross fares', value: money(totals.gross), hint: `${plural(totals.trips, 'completed trip')}`, icon: 'wallet', tone: 'blue' })}
        ${statCard({ label: 'Driver take-home', value: money(totals.driver_earnings), hint: `Avg fare ${money(totals.avg_fare)}`, icon: 'award', tone: 'green' })}
        ${statCard({ label: 'Platform earnings', value: money(totals.platform_earnings), hint: cfg.model === 'commission' ? `${money(totals.commission)} commission` : `${money(totals.incentive)} incentive paid`, icon: 'trending-up', tone: totals.platform_earnings >= 0 ? 'green' : 'red' })}
        ${statCard({ label: 'Commission collected', value: money(totals.commission), hint: `${cfg.commission_rate}% when active`, icon: 'check-circle', tone: 'amber' })}
        ${statCard({ label: 'Incentive paid', value: money(totals.incentive), hint: `${cfg.incentive_rate}% when active`, icon: 'zap', tone: 'violet' })}
        ${statCard({ label: 'Ledger rows', value: String(totals.trips), hint: `Last ${rev.window_days} days`, icon: 'ticket', tone: 'blue' })}
      </div>

      <section class="panel admin-panel">
        ${sectionHead('Daily gross', { description: 'Gross fares and driver take-home per day.' })}
        <div class="insight-bars">
          ${rev.daily.length
            ? rev.daily.map((row) => `
              <div class="insight-bar-row">
                <span class="insight-bar-label">${esc(row.date)}</span>
                <div class="mini-bar"><i style="width:${Math.max(3, Math.round((row.gross / maxDay) * 100))}%"></i></div>
                <span class="insight-bar-value">${money(row.gross)} <small>${plural(row.trips, 'trip')}</small></span>
              </div>
            `).join('')
            : '<p class="text-muted">No completed trips in this window.</p>'}
        </div>
      </section>

      <section class="panel admin-panel">
        ${sectionHead('Top earners', { description: 'Drivers ranked by take-home in this window.' })}
        ${tableBlock(
          '<th>Driver</th><th class="num">Trips</th><th class="num">Gross</th><th class="num">Commission</th><th class="num">Incentive</th><th class="num">Take-home</th>',
          rev.by_driver.map((row) => `<tr>
            <td><strong>${esc(row.name)}</strong>${row.vehicle_class ? ` <small class="text-muted">${esc(vehicleClass(row.vehicle_class).name)}</small>` : ''}</td>
            <td class="num">${row.trips}</td>
            <td class="num">${money(row.gross)}</td>
            <td class="num">${money(row.commission)}</td>
            <td class="num">${money(row.incentive)}</td>
            <td class="num"><strong>${money(row.take_home)}</strong></td>
          </tr>`).join(''),
          { icon: 'award', title: 'No payouts yet', text: 'Ledger rows appear when trips complete.' },
        )}
      </section>

      <section class="panel admin-panel">
        ${sectionHead('Recent ledger', { description: 'Every completed trip is settled exactly once.' })}
        ${tableBlock(
          '<th>When</th><th>Ride</th><th>Driver</th><th>Rider</th><th class="num">Fare</th><th>Model</th><th class="num">Driver earned</th>',
          rev.recent.map((row) => `<tr>
            <td class="nowrap">${esc(relative(row.created_at))}</td>
            <td class="nowrap"><strong>${esc(row.code || `#${row.booking_id}`)}</strong></td>
            <td>${esc(row.driver_name)}</td>
            <td>${esc(row.rider_name)}</td>
            <td class="num">${money(row.fare)}</td>
            <td>${pill(titleCase(row.model), row.model === 'incentive' ? 'violet' : 'blue')}</td>
            <td class="num"><strong>${money(row.driver_earning)}</strong></td>
          </tr>`).join(''),
          { icon: 'ticket', title: 'No ledger entries', text: 'Completed trips are settled into the ledger automatically.' },
        )}
      </section>
    `;
  };

  /* ---------------------------------------------------------------- */
  /* Audience (website analytics)                                      */
  /* ---------------------------------------------------------------- */

  const paintAnalytics = () => {
    const host = bodyFor('analytics');
    if (!host || !data.analytics) return;
    const an = data.analytics;
    const maxDay = Math.max(1, ...an.daily.map((row) => row.pageviews));
    const maxEvent = Math.max(1, ...an.events_by_type.map((row) => row.count));
    const maxPage = Math.max(1, ...an.top_pages.map((row) => row.pageviews));
    const maxRef = Math.max(1, ...an.top_referrers.map((row) => row.pageviews));

    host.innerHTML = `
      ${toolbar({
        title: 'Website audience',
        description: 'Aggregate page counters for advertisers. No cookies, no IP addresses, no user ids and no query strings are stored.',
      })}

      <div class="stat-strip" style="margin-bottom:16px">
        ${statCard({ label: 'Page views', value: String(an.pageviews), hint: `Last ${an.window_days} days`, icon: 'eye', tone: 'blue' })}
        ${statCard({ label: 'Tracked events', value: String(an.events), hint: `${plural(an.events_by_type.length, 'event type')}`, icon: 'sparkle', tone: 'violet' })}
        ${statCard({ label: 'Active days', value: String(an.active_days), hint: 'Days with any traffic', icon: 'calendar', tone: 'green' })}
        ${statCard({ label: 'Daily average', value: String(an.daily_average), hint: 'Page views per active day', icon: 'trending-up', tone: 'amber' })}
      </div>

      <section class="panel admin-panel">
        ${sectionHead('Traffic over time', { description: 'Page views per day in this window.' })}
        <div class="insight-bars">
          ${an.daily.map((row) => `
            <div class="insight-bar-row">
              <span class="insight-bar-label">${esc(row.day)}</span>
              <div class="mini-bar"><i style="width:${row.pageviews ? Math.max(3, Math.round((row.pageviews / maxDay) * 100)) : 0}%"></i></div>
              <span class="insight-bar-value">${row.pageviews} <small>${plural(row.events, 'event')}</small></span>
            </div>
          `).join('')}
        </div>
      </section>

      <div class="insight-split">
        <section class="panel admin-panel">
          ${sectionHead('Top pages', { description: 'Paths are normalised — ids are collapsed to /:id.' })}
          <div class="insight-bars">
            ${an.top_pages.length
              ? an.top_pages.map((row) => `
                <div class="insight-bar-row">
                  <span class="insight-bar-label">${esc(row.path)}</span>
                  <div class="mini-bar"><i style="width:${Math.max(3, Math.round((row.pageviews / maxPage) * 100))}%"></i></div>
                  <span class="insight-bar-value">${row.pageviews}</span>
                </div>
              `).join('')
              : '<p class="text-muted">No page views recorded yet.</p>'}
          </div>
        </section>

        <section class="panel admin-panel">
          ${sectionHead('Where visitors come from', { description: 'Referrer host only — never the full URL.' })}
          <div class="insight-bars">
            ${an.top_referrers.length
              ? an.top_referrers.map((row) => `
                <div class="insight-bar-row">
                  <span class="insight-bar-label">${esc(row.host)}</span>
                  <div class="mini-bar"><i style="width:${Math.max(3, Math.round((row.pageviews / maxRef) * 100))}%"></i></div>
                  <span class="insight-bar-value">${row.pageviews}</span>
                </div>
              `).join('')
              : '<p class="text-muted">No external referrers yet.</p>'}
          </div>
        </section>
      </div>

      <section class="panel admin-panel">
        ${sectionHead('Events', { description: 'Actions counted across the public website.' })}
        <div class="insight-bars">
          ${an.events_by_type.length
            ? an.events_by_type.map((row) => `
              <div class="insight-bar-row">
                <span class="insight-bar-label">${esc(titleCase(row.event))}</span>
                <div class="mini-bar"><i style="width:${Math.max(3, Math.round((row.count / maxEvent) * 100))}%"></i></div>
                <span class="insight-bar-value">${row.count}</span>
              </div>
            `).join('')
            : '<p class="text-muted">No events recorded yet.</p>'}
        </div>
        <p class="fine-print">${icon('shield', 13)} ${esc(an.privacy.note)}</p>
      </section>
    `;
  };

  /* ---------------------------------------------------------------- */
  /* Area map (geohash performance dashboard)                          */
  /* ---------------------------------------------------------------- */

  let areaMap = null;
  let areaLayer = null;
  let areaMetric = 'requests';

  const AREA_METRICS = [
    { key: 'requests', label: 'Requests', hint: 'Ride requests in this area' },
    { key: 'success', label: 'Success rate', hint: 'Completed ÷ requested' },
    { key: 'revenue', label: 'Money', hint: 'Gross fares from completed trips' },
  ];

  const destroyAreaMap = () => {
    if (areaLayer) {
      try { areaLayer.clearLayers(); } catch { /* ignore */ }
      areaLayer = null;
    }
    if (areaMap) {
      try { areaMap.destroy(); } catch { /* ignore */ }
      areaMap = null;
    }
  };

  const areaTone = (cell) => {
    if (cell.requests < 1) return 'muted';
    if (cell.success_delta >= 8) return 'green';
    if (cell.success_delta <= -8) return 'red';
    return 'amber';
  };

  const paintAreaMap = () => {
    const host = bodyFor('map');
    if (!host || !data.map) return;
    // Tear down any previous Leaflet instance before replacing the panel DOM.
    destroyAreaMap();
    const demand = data.map.demand || {};
    const cells = demand.areas || [];
    const totals = demand.totals || {
      requests: 0, completed: 0, cancelled: 0, gross: 0, success_rate: 0, avg_fare: 0,
    };

    if (!cells.length) {
      host.innerHTML = `
        ${toolbar({ title: 'Active areas', description: 'Ride success and money by area.' })}
        ${emptyState({ icon: 'map-pin', title: 'No pickup areas yet', text: 'Areas appear here once riders start requesting trips.' })}
      `;
      return;
    }

    const bestSuccess = [...cells]
      .filter((cell) => cell.requests >= 3)
      .sort((a, b) => b.success_rate - a.success_rate || b.requests - a.requests)[0] || null;
    const bestMoney = [...cells].sort((a, b) => b.gross - a.gross)[0] || null;

    host.innerHTML = `
      ${toolbar({
        title: 'Active areas',
        description: `Ride success and money for the last ${data.map.window_days} days. Every bubble is a ~1.2 km geohash cell; bubble size follows the selected metric and the legend explains the colour.`,
      })}

      <div class="stat-strip" style="margin-bottom:16px">
        ${statCard({ label: 'Areas with demand', value: String(cells.length), hint: `${demand.cells_covered} cells in window`, icon: 'map-pin', tone: 'blue' })}
        ${statCard({ label: 'Ride success', value: `${totals.success_rate}%`, hint: `${totals.completed} of ${totals.requests} requests completed`, icon: 'check-circle', tone: totals.success_rate >= 60 ? 'green' : 'amber' })}
        ${statCard({ label: 'Gross fares', value: money(totals.gross), hint: `Avg fare ${money(totals.avg_fare)}`, icon: 'wallet', tone: 'green' })}
        ${statCard({ label: 'Online drivers', value: String(demand.online_supply || 0), hint: 'Across all areas now', icon: 'car', tone: 'violet' })}
      </div>

      <section class="panel admin-panel">
        ${sectionHead('Where the city is moving', { description: 'Tap a bubble for the area breakdown. Toggle the metric to compare volume, success and money.' })}
        <div class="area-metric-toggle" role="group" aria-label="Map metric">
          ${AREA_METRICS.map((metric) => `
            <button type="button" class="btn btn-xs ${areaMetric === metric.key ? 'btn-primary' : 'btn-ghost'}" data-area-metric="${metric.key}" title="${esc(metric.hint)}">${esc(metric.label)}</button>
          `).join('')}
        </div>
        <div id="area-map" class="area-map-canvas" aria-label="Area performance map"></div>
        <div class="area-legend" id="area-legend"></div>
      </section>

      <div class="area-callouts">
        ${bestSuccess ? `
          <div class="area-callout">
            <span class="area-callout-label">${icon('check-circle', 14)} Highest success</span>
            <strong>${esc(bestSuccess.sample || `${bestSuccess.lat.toFixed(2)}, ${bestSuccess.lng.toFixed(2)}`)}</strong>
            <span>${bestSuccess.success_rate}% · ${bestSuccess.completed} of ${bestSuccess.requests} · ${bestSuccess.success_delta >= 0 ? '+' : ''}${bestSuccess.success_delta} pts vs city</span>
          </div>` : ''}
        ${bestMoney ? `
          <div class="area-callout">
            <span class="area-callout-label">${icon('wallet', 14)} Most money</span>
            <strong>${esc(bestMoney.sample || `${bestMoney.lat.toFixed(2)}, ${bestMoney.lng.toFixed(2)}`)}</strong>
            <span>${money(bestMoney.gross)} · ${bestMoney.gross_share}% of city gross · ${bestMoney.completed} trips</span>
          </div>` : ''}
      </div>

      <section class="panel admin-panel">
        ${sectionHead('Area scoreboard', { description: 'Success and money compared with the citywide baseline, busiest areas first.' })}
        ${tableBlock(
          '<th class="num">#</th><th>Area</th><th class="num">Requests</th><th class="num">Success</th><th class="num">vs city</th><th class="num">Gross</th><th class="num">Avg fare</th><th class="num">Money share</th><th class="num">Online</th><th class="num">Surge</th>',
          cells.map((cell, index) => `<tr>
            <td class="num">${index + 1}</td>
            <td><strong>${esc(cell.sample || `${cell.lat.toFixed(2)}, ${cell.lng.toFixed(2)}`)}</strong><br><small class="text-muted">${esc(cell.cell)} · peak ${cell.peak_hour == null ? '—' : `${String(cell.peak_hour).padStart(2, '0')}:00`}</small></td>
            <td class="num">${cell.requests} <small class="text-muted">(${cell.request_share}%)</small></td>
            <td class="num">${pill(`${cell.success_rate}%`, areaTone(cell))}</td>
            <td class="num">${cell.success_delta >= 0 ? '+' : ''}${cell.success_delta} pts</td>
            <td class="num"><strong>${money(cell.gross)}</strong></td>
            <td class="num">${cell.avg_fare ? money(cell.avg_fare) : '—'}</td>
            <td class="num">${cell.gross_share}%</td>
            <td class="num">${cell.online_drivers}</td>
            <td class="num">${cell.surge > 1 ? pill(`×${cell.surge}`, 'amber') : pill('×1', 'muted')}</td>
          </tr>`).join(''),
          { icon: 'map-pin', title: 'No areas yet', text: 'Area performance appears once rides are requested.' },
        )}
      </section>
    `;

    const mapEl = host.querySelector('#area-map');
    if (!mapEl) return;
    areaMap = new RideMap(mapEl, { center: { lat: ADDIS.lat, lng: ADDIS.lng }, zoom: 12 });
    const legendEl = host.querySelector('#area-legend');

    const paintCells = () => {
      if (!areaMap?.map || !window.L) return;
      const L = window.L;
      if (!areaLayer) areaLayer = L.layerGroup().addTo(areaMap.map);
      areaLayer.clearLayers();

      const maxRequests = Math.max(1, ...cells.map((cell) => cell.requests));
      const maxGross = Math.max(1, ...cells.map((cell) => cell.gross));

      const colorFor = (cell) => {
        if (areaMetric === 'success') {
          if (cell.success_rate >= totals.success_rate + 10) return '#15803d';
          if (cell.success_rate >= totals.success_rate) return '#65a30d';
          if (cell.success_rate >= totals.success_rate - 10) return '#d97706';
          return '#b91c1c';
        }
        if (areaMetric === 'revenue') {
          const share = cell.gross / maxGross;
          if (share >= 0.6) return '#15803d';
          if (share >= 0.3) return '#0f766e';
          if (share > 0) return '#0ea5e9';
          return '#94a3b8';
        }
        const share = cell.requests / maxRequests;
        if (share >= 0.6) return '#b91c1c';
        if (share >= 0.3) return '#ea580c';
        return '#f59e0b';
      };

      const radiusFor = (cell) => {
        // Size always tracks volume so a single lucky request never looks huge;
        // the colour carries the success / revenue signal.
        if (areaMetric === 'revenue') return 12 + Math.sqrt(cell.gross / maxGross) * 26;
        return 12 + Math.sqrt(cell.requests / maxRequests) * 26;
      };

      for (const cell of cells) {
        const label = cell.sample || `${cell.lat.toFixed(2)}, ${cell.lng.toFixed(2)}`;
        const marker = L.circleMarker([cell.lat, cell.lng], {
          radius: radiusFor(cell),
          color: '#ffffff',
          weight: 1.5,
          fillColor: colorFor(cell),
          fillOpacity: 0.72,
        }).addTo(areaLayer);
        marker.bindTooltip(
          `<strong>${esc(label)}</strong><br>${cell.requests} requests · ${cell.success_rate}% success<br>${money(cell.gross)} gross`,
          { direction: 'top', opacity: 0.95 },
        );
        marker.bindPopup(`
          <strong>${esc(label)}</strong><br>
          <small>${esc(cell.cell)}</small>
          <hr>
          Requests: <strong>${cell.requests}</strong> (${cell.request_share}% of city)<br>
          Completed: <strong>${cell.completed}</strong> · Cancelled: ${cell.cancelled} · Active: ${cell.active}<br>
          Success: <strong>${cell.success_rate}%</strong> (${cell.success_delta >= 0 ? '+' : ''}${cell.success_delta} pts vs city)<br>
          Gross: <strong>${money(cell.gross)}</strong> · Avg fare ${cell.avg_fare ? money(cell.avg_fare) : '—'}<br>
          Online drivers: ${cell.online_drivers} · Surge hint ${cell.surge > 1 ? `×${cell.surge}` : 'none'}
        `);
      }

      const bounds = L.latLngBounds(cells.map((cell) => [cell.lat, cell.lng]));
      if (bounds.isValid()) areaMap.map.fitBounds(bounds.pad(0.2), { maxZoom: 13 });

      if (legendEl) {
        legendEl.innerHTML = areaMetric === 'success'
          ? '<span><i style="background:#15803d"></i> Above city average</span><span><i style="background:#d97706"></i> Near average</span><span><i style="background:#b91c1c"></i> Below average</span>'
          : areaMetric === 'revenue'
            ? '<span><i style="background:#15803d"></i> Highest gross</span><span><i style="background:#0f766e"></i> Mid gross</span><span><i style="background:#0ea5e9"></i> Lower gross</span><span><i style="background:#94a3b8"></i> No completed trips</span>'
            : '<span><i style="background:#b91c1c"></i> Busiest</span><span><i style="background:#ea580c"></i> Busy</span><span><i style="background:#f59e0b"></i> Quiet</span>';
      }
    };

    paintCells();

    host.querySelectorAll('[data-area-metric]').forEach((button) => {
      button.addEventListener('click', () => {
        areaMetric = button.dataset.areaMetric;
        host.querySelectorAll('[data-area-metric]').forEach((other) => {
          const active = other.dataset.areaMetric === areaMetric;
          other.classList.toggle('btn-primary', active);
          other.classList.toggle('btn-ghost', !active);
        });
        paintCells();
      });
    });

    window.setTimeout(() => areaMap?.invalidate(), 120);
  };

  /* ---------------------------------------------------------------- */
  /* Loaders                                                           */
  /* ---------------------------------------------------------------- */

  const painters = {
    overview: paintOverview,
    insights: paintInsights,
    map: paintAreaMap,
    revenue: paintRevenue,
    analytics: paintAnalytics,
    drivers: paintDrivers,
    users: paintUsers,
    bookings: paintBookings,
    tours: paintTours,
    events: paintEvents,
    routes: paintRoutes,
    fares: paintFares,
    safety: paintReports,
    email: paintEmail,
    site: paintSite,
    audit: paintAudit,
  };

  const loaders = {
    overview: () => api('/admin/overview').then((result) => { data.overview = result; }),
    insights: () => api('/admin/insights?days=30').then((result) => { data.insights = result; }),
    map: () => api('/admin/insights?days=30').then((result) => { data.map = result; }),
    revenue: () => api('/admin/revenue?days=30').then((result) => { data.revenue = result; }),
    analytics: () => api('/admin/analytics?days=30').then((result) => { data.analytics = result; }),
    drivers: () => api('/admin/drivers').then((result) => { data.drivers = result.drivers || []; }),
    users: () => {
      const params = new URLSearchParams();
      if (queries.users) params.set('q', queries.users);
      if (filters.users !== 'all') params.set('role', filters.users);
      return api(`/admin/users${params.toString() ? `?${params}` : ''}`).then((result) => { data.users = result.users || []; });
    },
    bookings: () => api('/admin/bookings').then((result) => { data.bookings = result.bookings || []; }),
    tours: () => api('/admin/tours').then((result) => { data.tours = result.tours || []; }),
    events: () => api('/admin/events').then((result) => { data.events = result.events || []; }),
    routes: () => api('/admin/routes').then((result) => { data.routes = result.routes || []; }),
    fares: () => api('/admin/fares').then((result) => { data.fares = result.fares || []; }),
    safety: () => api(`/admin/reports?status=${encodeURIComponent(filters.reports)}`).then((result) => { data.reports = result.reports || []; }),
    email: async () => {
      const [settings, subscribers] = await Promise.all([
        api('/admin/email/settings'),
        api('/admin/subscribers'),
      ]);
      data.email = settings;
      data.subscribers = subscribers.subscribers || [];
    },
    site: () => api('/admin/site').then((result) => { data.site = result; }),
    audit: () => api('/admin/audit').then((result) => { data.audit = result.audit || []; }),
  };

  const loadTab = async (key, { force = false, quiet = false } = {}) => {
    const host = bodyFor(key);
    if (!host || loading.has(key)) return;
    if (loaded.has(key) && !force) {
      painters[key]();
      return;
    }
    loading.add(key);
    if (!quiet) host.innerHTML = skeletons(3, key === 'tours' ? 'tour-skeleton' : 'line-skeleton');
    try {
      await loaders[key]();
      loaded.add(key);
      painters[key]();
    } catch (error) {
      loaded.add(key);
      host.innerHTML = errorBlock(error.message, { id: `admin-${key}-retry` });
      $(`#admin-${key}-retry`, host)?.addEventListener('click', () => {
        loaded.delete(key);
        void loadTab(key, { force: true });
      });
    } finally {
      loading.delete(key);
    }
  };

  const reloadTab = async (key, { quiet = true } = {}) => {
    loaded.delete(key);
    await loadTab(key, { force: true, quiet });
  };

  const refreshOverviewStats = () => {
    loaded.delete('overview');
    void loadTab('overview', { force: true, quiet: true });
  };

  /* ---------------------------------------------------------------- */
  /* Modals                                                            */
  /* ---------------------------------------------------------------- */

  const openPersonModal = async ({ role: presetRole = 'customer' } = {}) => {
    const driverFields = `
      <div class="field-grid" data-driver-fields ${presetRole === 'driver' ? '' : 'hidden'}>
        ${selectField({ label: 'Vehicle class', name: 'vehicle_class', value: 'e2', options: VEHICLE_CLASSES.map((key) => ({ value: key, label: vehicleClass(key).name })) })}
        ${inputField({ label: 'Make & model', name: 'make_model', placeholder: 'BYD E2', max: 60 })}
        ${inputField({ label: 'Plate', name: 'plate', placeholder: 'AA 2 12345', max: 20 })}
        ${inputField({ label: 'Vehicle colour', name: 'color', placeholder: 'Pearl white', max: 30 })}
        ${inputField({ label: 'Licence number', name: 'license_no', placeholder: 'DL-AA-00000', max: 40, wide: true })}
      </div>
    `;
    const body = `
      <div class="field-grid">
        ${inputField({ label: 'Full name', name: 'name', required: true, max: 60, autocomplete: 'off' })}
        ${inputField({ label: 'Email address', name: 'email', type: 'email', required: true, max: 120 })}
        ${inputField({ label: 'Phone number', name: 'phone', max: 30, placeholder: '+251 91 234 5678' })}
        ${inputField({ label: 'Temporary password', name: 'password', type: 'password', required: true, min: 8, max: 128, hint: 'At least 8 characters with a letter and a number.' })}
        ${selectField({ label: 'Role', name: 'role', value: presetRole, options: [{ value: 'customer', label: 'Rider' }, { value: 'driver', label: 'Driver' }, { value: 'admin', label: 'Admin' }] })}
        ${selectField({ label: 'Verified', name: 'is_verified', value: '0', options: [{ value: '0', label: 'Not verified' }, { value: '1', label: 'Verified' }] })}
        ${textareaField({ label: 'Bio', name: 'bio', rows: 3, maxLength: 400, hint: 'Optional. Shown on tour profiles.' })}
      </div>
      ${driverFields}
    `;

    const saved = await openFormModal({
      title: 'Add a person',
      eyebrow: 'People CRM',
      size: 'lg',
      body,
      submitLabel: 'Create account',
      onSubmit: async (formData, form) => {
        const payload = formObject(formData);
        payload.is_verified = payload.is_verified === '1';
        if (payload.role !== 'driver') {
          delete payload.vehicle_class;
          delete payload.make_model;
          delete payload.plate;
          delete payload.color;
          delete payload.license_no;
        }
        await api('/admin/users', { method: 'POST', body: payload });
      },
    });

    if (!saved) return;
    toast('Account created.');
    await reloadTab('users', { quiet: false });
    if (presetRole === 'driver') await reloadTab('drivers', { quiet: false });
    refreshOverviewStats();
  };

  const editDriverModal = async (driver) => {
    const body = `<div class="field-grid">
      ${selectField({ label: 'Vehicle class', name: 'vehicle_class', value: driver.vehicle_class, options: VEHICLE_CLASSES.map((key) => ({ value: key, label: vehicleClass(key).name })) })}
      ${inputField({ label: 'Make & model', name: 'make_model', value: driver.make_model, required: true, max: 60 })}
      ${inputField({ label: 'Plate', name: 'plate', value: driver.plate, required: true, max: 20 })}
      ${inputField({ label: 'Vehicle colour', name: 'color', value: driver.color, max: 30 })}
      ${inputField({ label: 'Licence number', name: 'license_no', value: driver.license_no, required: true, max: 40 })}
      ${selectField({ label: 'Driver status', name: 'status', value: driver.status, options: DRIVER_FILTERS.slice(1).map((key) => ({ value: key, label: titleCase(key) })) })}
    </div>`;
    const saved = await openFormModal({
      title: `Edit ${driver.name}`,
      eyebrow: 'Driver profile',
      body,
      submitLabel: 'Save driver',
      onSubmit: async (formData) => {
        await api(`/admin/drivers/${driver.id}`, { method: 'PATCH', body: formObject(formData) });
      },
    });
    if (!saved) return;
    toast('Driver updated.');
    await reloadTab('drivers', { quiet: false });
    refreshOverviewStats();
  };

  const editUserModal = async (person) => {
    const body = `<div class="field-grid">
      ${inputField({ label: 'Full name', name: 'name', value: person.name, required: true, max: 60 })}
      ${inputField({ label: 'Phone number', name: 'phone', value: person.phone, max: 30 })}
      ${selectField({ label: 'Account status', name: 'status', value: person.status, options: [{ value: 'active', label: 'Active' }, { value: 'suspended', label: 'Suspended' }] })}
      ${selectField({ label: 'Verified', name: 'is_verified', value: person.is_verified ? '1' : '0', options: [{ value: '0', label: 'Not verified' }, { value: '1', label: 'Verified' }] })}
      ${textareaField({ label: 'Bio', name: 'bio', value: person.bio, rows: 3, maxLength: 400 })}
    </div>`;
    const saved = await openFormModal({
      title: `Edit ${person.name}`,
      eyebrow: roleLabel(person.role),
      body,
      submitLabel: 'Save person',
      onSubmit: async (formData) => {
        const payload = formObject(formData);
        payload.is_verified = payload.is_verified === '1';
        await api(`/admin/users/${person.id}`, { method: 'PATCH', body: payload });
      },
    });
    if (!saved) return;
    toast('Person updated.');
    await reloadTab('users', { quiet: false });
    refreshOverviewStats();
  };

  const editBookingModal = async (booking) => {
    const body = `<div class="field-grid">
      ${selectField({ label: 'Ride status', name: 'status', value: booking.status, options: BOOKING_STATUSES.map((key) => ({ value: key, label: titleCase(key) })) })}
      ${inputField({ label: 'Fare (ETB)', name: 'fare', value: String(booking.fare), type: 'number', min: 0, max: 100000, step: 5, required: true })}
      ${inputField({ label: 'Scheduled for', name: 'scheduled_for', value: booking.scheduled_for ? toLocalInput(booking.scheduled_for) : '', type: 'datetime-local', wide: true, hint: 'Leave blank for an immediate ride.' })}
      ${textareaField({ label: 'Operator notes', name: 'notes', value: booking.notes, rows: 3, maxLength: 300 })}
    </div>`;

    const saved = await openFormModal({
      title: `Ride ${booking.code}`,
      eyebrow: `${booking.customer?.name || 'Rider'} · ${booking.pickup} → ${booking.dropoff}`,
      body,
      submitLabel: 'Save ride',
      onSubmit: async (formData) => {
        const raw = formObject(formData);
        const payload = { status: raw.status, fare: Number(raw.fare), notes: raw.notes };
        if (raw.scheduled_for) payload.scheduled_for = localToIso(raw.scheduled_for, 'Scheduled time');
        else payload.scheduled_for = null;
        await api(`/admin/bookings/${booking.id}`, { method: 'PATCH', body: payload });
      },
    });
    if (!saved) return;
    toast('Ride updated.');
    await reloadTab('bookings', { quiet: false });
    refreshOverviewStats();
  };

  const tourModal = async (tour = null) => {
    const editing = Boolean(tour);
    const body = `<div class="field-grid">
      ${inputField({ label: 'Tour title', name: 'title', value: tour?.title || '', required: true, max: 80, wide: true })}
      ${photoAttachField({ label: 'Tour photo', value: tour?.image_url || '', hint: 'Attach a tour photo or cover image.' })}
      ${textareaField({ label: 'Description', name: 'description', value: tour?.description || '', rows: 4, maxLength: 1200, required: true, hint: 'At least 20 characters. Describe the route and what is included.' })}
      ${inputField({ label: 'Meeting point', name: 'meeting_point', value: tour?.meeting_point || '', required: true, max: 140, wide: true })}
      ${inputField({ label: 'Latitude', name: 'lat', value: String(tour?.lat ?? ADDIS.lat), type: 'number', step: '0.0001', required: true })}
      ${inputField({ label: 'Longitude', name: 'lng', value: String(tour?.lng ?? ADDIS.lng), type: 'number', step: '0.0001', required: true })}
      ${inputField({ label: 'Starts at', name: 'starts_at', value: tour ? toLocalInput(tour.starts_at) : defaultSchedule(72), type: 'datetime-local', required: true })}
      ${inputField({ label: 'Duration (minutes)', name: 'duration_min', value: String(tour?.duration_min ?? 120), type: 'number', min: 30, max: 720, required: true })}
      ${inputField({ label: 'Group size', name: 'capacity', value: String(tour?.capacity ?? 8), type: 'number', min: 2, max: 30, required: true })}
      ${inputField({ label: 'Price (ETB)', name: 'price', value: String(tour?.price ?? 0), type: 'number', min: 0, max: 100000, required: true, hint: 'Use 0 for a free community tour.' })}
      ${selectField({ label: 'Theme', name: 'theme', value: tour?.theme || 'entoto', options: TOUR_THEMES.map((key) => ({ value: key, label: titleCase(key) })) })}
      ${selectField({ label: 'Status', name: 'status', value: tour?.status || 'upcoming', options: TOUR_STATUSES.map((key) => ({ value: key, label: titleCase(key) })) })}
      ${inputField({ label: 'Host user ID', name: 'host_id', value: tour?.host?.id ? String(tour.host.id) : '', type: 'number', min: 1, hint: 'Optional. Leave blank to host as yourself.' })}
    </div>`;

    const saved = await openFormModal({
      title: editing ? 'Edit tour' : 'Add a tour',
      eyebrow: 'City calendar',
      size: 'lg',
      body,
      submitLabel: editing ? 'Save tour' : 'Create tour',
      onInit: (form) => setupPhotoAttachment(form, tour?.image_url || ''),
      onSubmit: async (formData) => {
        const raw = formObject(formData);
        const payload = {
          title: raw.title,
          image_url: raw.image_url || '',
          description: raw.description,
          meeting_point: raw.meeting_point,
          lat: Number(raw.lat),
          lng: Number(raw.lng),
          starts_at: localToIso(raw.starts_at, 'Start time'),
          duration_min: Number(raw.duration_min),
          capacity: Number(raw.capacity),
          price: Number(raw.price),
          theme: raw.theme,
          status: raw.status,
        };
        if (raw.host_id) payload.host_id = Number(raw.host_id);
        await api(editing ? `/admin/tours/${tour.id}` : '/admin/tours', {
          method: editing ? 'PATCH' : 'POST',
          body: payload,
        });
      },
    });
    if (!saved) return;
    toast(editing ? 'Tour updated.' : 'Tour created.');
    await reloadTab('tours', { quiet: false });
    refreshOverviewStats();
  };

  const eventModal = async (event = null) => {
    const editing = Boolean(event);
    const body = `<div class="field-grid">
      ${inputField({ label: 'Event title', name: 'title', value: event?.title || '', required: true, max: 120, wide: true })}
      ${photoAttachField({ label: 'Event photo', value: event?.image_url || '', hint: 'Attach an event photo or poster.' })}
      ${textareaField({ label: 'Description', name: 'description', value: event?.description || '', rows: 4, maxLength: 1200 })}
      ${inputField({ label: 'Venue', name: 'venue', value: event?.venue || '', max: 160, wide: true })}
      ${inputField({ label: 'Latitude', name: 'lat', value: event?.lat == null ? '' : String(event.lat), type: 'number', step: '0.0001', placeholder: 'Optional' })}
      ${inputField({ label: 'Longitude', name: 'lng', value: event?.lng == null ? '' : String(event.lng), type: 'number', step: '0.0001', placeholder: 'Optional' })}
      ${inputField({ label: 'Starts at', name: 'starts_at', value: event ? toLocalInput(event.starts_at) : defaultSchedule(48), type: 'datetime-local', required: true })}
      ${inputField({ label: 'Ends at', name: 'ends_at', value: event?.ends_at ? toLocalInput(event.ends_at) : '', type: 'datetime-local', hint: 'Optional.' })}
      ${selectField({ label: 'Category', name: 'category', value: event?.category || 'culture', options: EVENT_CATEGORIES.map((key) => ({ value: key, label: titleCase(key) })) })}
      ${inputField({ label: 'Ticket price (ETB)', name: 'price', value: String(event?.price ?? 0), type: 'number', min: 0, max: 100000, hint: 'Use 0 for a free event.' })}
      ${selectField({ label: 'Status', name: 'status', value: event?.status || 'published', options: [{ value: 'draft', label: 'Draft' }, { value: 'published', label: 'Published' }, { value: 'cancelled', label: 'Cancelled' }] })}
    </div>`;

    const saved = await openFormModal({
      title: editing ? 'Edit event' : 'Add an event',
      eyebrow: 'City guide',
      size: 'lg',
      body,
      submitLabel: editing ? 'Save event' : 'Publish event',
      onInit: (form) => setupPhotoAttachment(form, event?.image_url || ''),
      onSubmit: async (formData) => {
        const raw = formObject(formData);
        const payload = {
          title: raw.title,
          image_url: raw.image_url || '',
          description: raw.description,
          venue: raw.venue,
          starts_at: localToIso(raw.starts_at, 'Start time'),
          category: raw.category,
          price: Number(raw.price),
          status: raw.status,
        };
        if (raw.ends_at) payload.ends_at = localToIso(raw.ends_at, 'End time');
        if (raw.lat !== '' && raw.lng !== '') {
          payload.lat = Number(raw.lat);
          payload.lng = Number(raw.lng);
        }
        await api(editing ? `/admin/events/${event.id}` : '/admin/events', {
          method: editing ? 'PATCH' : 'POST',
          body: payload,
        });
      },
    });
    if (!saved) return;
    toast(editing ? 'Event updated.' : 'Event published.');
    await reloadTab('events', { quiet: false });
  };

  const routeModal = async (route = null) => {
    const editing = Boolean(route);
    const body = `<div class="field-grid">
      ${inputField({ label: 'Route name', name: 'name', value: route?.name || '', required: true, max: 100, wide: true })}
      ${textareaField({ label: 'Description', name: 'description', value: route?.description || '', rows: 3, maxLength: 800 })}
      ${inputField({ label: 'Start point', name: 'start_point', value: route?.start_point || '', required: true, max: 140 })}
      ${inputField({ label: 'End point', name: 'end_point', value: route?.end_point || '', required: true, max: 140 })}
      ${inputField({ label: 'Distance (km)', name: 'distance_km', value: String(route?.distance_km ?? 5), type: 'number', min: 0, max: 120, step: '0.1', required: true })}
      ${inputField({ label: 'Duration (minutes)', name: 'duration_min', value: String(route?.duration_min ?? 20), type: 'number', min: 0, max: 720, required: true })}
      ${selectField({ label: 'Ride class', name: 'vehicle_class', value: route?.vehicle_class || 'e2', options: VEHICLE_CLASSES.map((key) => ({ value: key, label: vehicleClass(key).name })) })}
      ${inputField({ label: 'Suggested fare (ETB)', name: 'fare', value: String(route?.fare ?? 250), type: 'number', min: 0, max: 100000, required: true })}
      ${selectField({ label: 'Status', name: 'status', value: route?.status || 'active', options: [{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Hidden' }] })}
    </div>`;

    const saved = await openFormModal({
      title: editing ? 'Edit route' : 'Add a city route',
      eyebrow: 'Curated journeys',
      size: 'lg',
      body,
      submitLabel: editing ? 'Save route' : 'Create route',
      onSubmit: async (formData) => {
        const raw = formObject(formData);
        await api(editing ? `/admin/routes/${route.id}` : '/admin/routes', {
          method: editing ? 'PATCH' : 'POST',
          body: {
            name: raw.name,
            description: raw.description,
            start_point: raw.start_point,
            end_point: raw.end_point,
            distance_km: Number(raw.distance_km),
            duration_min: Number(raw.duration_min),
            vehicle_class: raw.vehicle_class,
            fare: Number(raw.fare),
            status: raw.status,
          },
        });
      },
    });
    if (!saved) return;
    toast(editing ? 'Route updated.' : 'Route created.');
    await reloadTab('routes', { quiet: false });
  };

  const fareModal = async (fare) => {
    const body = `<div class="field-grid">
      ${inputField({ label: 'Base fare (ETB)', name: 'base', value: String(fare.base), type: 'number', min: 0, max: 5000, required: true })}
      ${inputField({ label: 'Per kilometre (ETB)', name: 'per_km', value: String(fare.per_km), type: 'number', min: 0, max: 500, step: '0.5', required: true })}
      ${inputField({ label: 'Per minute (ETB)', name: 'per_min', value: String(fare.per_min), type: 'number', min: 0, max: 500, step: '0.1', required: true })}
      ${inputField({ label: 'Minimum fare (ETB)', name: 'minimum', value: String(fare.minimum), type: 'number', min: 0, max: 100000, required: true })}
      ${inputField({ label: 'Seats', name: 'seats', value: String(fare.seats), type: 'number', min: 1, max: 12, required: true })}
      ${selectField({ label: 'Availability', name: 'is_active', value: fare.is_active ? '1' : '0', options: [{ value: '1', label: 'Active' }, { value: '0', label: 'Disabled' }] })}
    </div>
    <p class="fine-print">${icon('info', 14)} Estimated 5 km fare with these values: <strong>${esc(money(sampleFare(fare)))}</strong>. Changes apply to new estimates immediately.</p>`;

    const saved = await openFormModal({
      title: `Adjust ${fare.label} fare`,
      eyebrow: 'Pricing',
      body,
      submitLabel: 'Save fare',
      onSubmit: async (formData) => {
        const raw = formObject(formData);
        await api(`/admin/fares/${fare.key}`, {
          method: 'PATCH',
          body: {
            base: Number(raw.base),
            per_km: Number(raw.per_km),
            per_min: Number(raw.per_min),
            minimum: Number(raw.minimum),
            seats: Number(raw.seats),
            is_active: raw.is_active === '1',
          },
        });
      },
    });
    if (!saved) return;
    toast(`${fare.label} fare updated.`);
    await reloadTab('fares', { quiet: false });
  };

  const confirmDelete = (title, message, confirmLabel = 'Delete') => confirmModal({
    title,
    message,
    confirmLabel,
    cancelLabel: 'Keep it',
    danger: true,
  });

  /* ---------------------------------------------------------------- */
  /* Mutations                                                         */
  /* ---------------------------------------------------------------- */

  const setDriverStatus = async (id, status) => {
    const driver = data.drivers.find((item) => String(item.id) === String(id))
      || data.overview?.pending_drivers?.find((item) => String(item.id) === String(id));
    const label = status === 'approved' ? 'Approve' : status === 'suspended' ? 'Suspend' : 'Move to review';
    const ok = await confirmModal({
      title: `${label} this driver?`,
      message: status === 'approved'
        ? `${driver?.name || 'This driver'} will be able to go online and accept rides.`
        : status === 'suspended'
          ? `${driver?.name || 'This driver'} will be signed out of driver mode and cannot accept rides until reinstated.`
          : `${driver?.name || 'This driver'} will be moved back to the review queue.`,
      confirmLabel: label,
      danger: status === 'suspended',
    });
    if (!ok) return;
    const button = view.querySelector(`[data-driver-status="${status}"][data-driver-id="${id}"]`);
    await withBusy(button, async () => {
      try {
        const updated = await api(`/admin/drivers/${id}`, { method: 'PATCH', body: { status } });
        data.drivers = data.drivers.map((item) => (String(item.id) === String(id) ? updated : item));
        if (data.overview) {
          data.overview.pending_drivers = data.overview.pending_drivers.filter((item) => String(item.id) !== String(id));
        }
        toast(`${updated.name} is now ${status}.`);
        paintDrivers();
        refreshOverviewStats();
      } catch (error) {
        toastError(error, 'Could not update this driver.');
      }
    });
  };

  const setUserStatus = async (id, status, name) => {
    const ok = await confirmModal({
      title: status === 'suspended' ? 'Suspend this account?' : 'Reactivate this account?',
      message: status === 'suspended'
        ? `${name} will be signed out immediately and cannot book or drive until reactivated.`
        : `${name} will be able to sign in and use AddisGo again.`,
      confirmLabel: status === 'suspended' ? 'Suspend account' : 'Reactivate',
      danger: status === 'suspended',
    });
    if (!ok) return;
    const button = view.querySelector(`[data-user-status="${status}"][data-user-id="${id}"]`);
    await withBusy(button, async () => {
      try {
        const updated = await api(`/admin/users/${id}`, { method: 'PATCH', body: { status } });
        data.users = data.users.map((user) => (user.id === id ? updated : user));
        toast(status === 'suspended' ? 'Account suspended.' : 'Account reactivated.');
        paintUsers();
        refreshOverviewStats();
      } catch (error) {
        toastError(error, 'Could not update this account.');
      }
    });
  };

  const setUserVerified = async (id, verified) => {
    const button = view.querySelector(`[data-user-verify="${verified ? '1' : '0'}"][data-user-id="${id}"]`);
    await withBusy(button, async () => {
      try {
        const updated = await api(`/admin/users/${id}`, { method: 'PATCH', body: { is_verified: verified } });
        data.users = data.users.map((user) => (user.id === id ? updated : user));
        toast(verified ? 'Person verified.' : 'Verification removed.');
        paintUsers();
      } catch (error) {
        toastError(error, 'Could not update verification.');
      }
    });
  };

  const deleteUser = async (id) => {
    const person = data.users.find((user) => user.id === id);
    const ok = await confirmDelete(
      'Delete this account?',
      `${person?.name || 'This person'} will lose access immediately. Accounts with rides, tours or reports on record cannot be deleted — suspend them instead.`,
      'Delete account',
    );
    if (!ok) return;
    try {
      await api(`/admin/users/${id}`, { method: 'DELETE' });
      data.users = data.users.filter((user) => user.id !== id);
      toast('Account deleted.');
      paintUsers();
      refreshOverviewStats();
    } catch (error) {
      toastError(error, 'Could not delete this account.');
    }
  };

  const deleteDriver = async (id) => {
    const driver = data.drivers.find((item) => String(item.id) === String(id));
    const ok = await confirmDelete(
      'Remove this driver profile?',
      `${driver?.name || 'This driver'} will be moved back to a rider account. Drivers with rides on record must be suspended instead.`,
      'Remove profile',
    );
    if (!ok) return;
    try {
      await api(`/admin/drivers/${id}`, { method: 'DELETE' });
      data.drivers = data.drivers.filter((item) => String(item.id) !== String(id));
      toast('Driver profile removed.');
      paintDrivers();
      await reloadTab('users', { quiet: true });
      refreshOverviewStats();
    } catch (error) {
      toastError(error, 'Could not remove this driver.');
    }
  };

  const deleteBooking = async (id) => {
    const booking = data.bookings.find((item) => item.id === id);
    const ok = await confirmDelete(
      'Delete this ride?',
      `Ride ${booking?.code || ''} and its chat history will be removed. Live rides must be cancelled first.`,
      'Delete ride',
    );
    if (!ok) return;
    try {
      await api(`/admin/bookings/${id}`, { method: 'DELETE' });
      data.bookings = data.bookings.filter((item) => item.id !== id);
      toast('Ride deleted.');
      paintBookings();
      refreshOverviewStats();
    } catch (error) {
      toastError(error, 'Could not delete this ride.');
    }
  };

  const resolveReport = async (id, status) => {
    const ok = await confirmModal({
      title: status === 'resolved' ? 'Mark this report resolved?' : 'Dismiss this report?',
      message: status === 'resolved'
        ? 'The reporter will be notified that the safety desk reviewed the issue.'
        : 'The reporter will be notified that no further action was needed.',
      confirmLabel: status === 'resolved' ? 'Resolve report' : 'Dismiss report',
    });
    if (!ok) return;
    const button = view.querySelector(`[data-report-action="${status}"][data-report-id="${id}"]`);
    await withBusy(button, async () => {
      try {
        await api(`/admin/reports/${id}`, { method: 'PATCH', body: { status } });
        toast(status === 'resolved' ? 'Report resolved.' : 'Report dismissed.');
        await reloadTab('safety');
        refreshOverviewStats();
      } catch (error) {
        toastError(error, 'Could not close this report.');
      }
    });
  };

  const deleteReport = async (id) => {
    const ok = await confirmDelete('Delete this report?', 'The report will be permanently removed from the safety desk.', 'Delete report');
    if (!ok) return;
    try {
      await api(`/admin/reports/${id}`, { method: 'DELETE' });
      data.reports = data.reports.filter((report) => report.id !== id);
      toast('Report deleted.');
      paintReports();
      refreshOverviewStats();
    } catch (error) {
      toastError(error, 'Could not delete this report.');
    }
  };

  const cancelTour = async (id) => {
    const tour = data.tours.find((item) => item.id === id);
    const ok = await confirmModal({
      title: 'Cancel this tour?',
      message: `${tour?.title || 'This tour'} will be closed and every member will be notified.`,
      confirmLabel: 'Cancel tour',
      cancelLabel: 'Keep it running',
      danger: true,
    });
    if (!ok) return;
    const button = view.querySelector(`[data-tour-cancel="${id}"]`);
    await withBusy(button, async () => {
      try {
        await api(`/admin/tours/${id}`, {
          method: 'PATCH',
          body: {
            title: tour.title,
            description: tour.description,
            meeting_point: tour.meeting_point,
            lat: tour.lat,
            lng: tour.lng,
            starts_at: tour.starts_at,
            duration_min: tour.duration_min,
            capacity: tour.capacity,
            price: tour.price,
            theme: tour.theme,
            status: 'cancelled',
            host_id: tour.host.id,
          },
        });
        toast('Tour cancelled and members notified.');
        await reloadTab('tours');
        refreshOverviewStats();
      } catch (error) {
        toastError(error, 'Could not cancel this tour.');
      }
    });
  };

  const deleteTour = async (id) => {
    const tour = data.tours.find((item) => item.id === id);
    const ok = await confirmDelete(
      'Delete this tour?',
      `${tour?.title || 'This tour'}, its members and its chat history will be permanently removed.`,
      'Delete tour',
    );
    if (!ok) return;
    try {
      await api(`/admin/tours/${id}`, { method: 'DELETE' });
      data.tours = data.tours.filter((item) => item.id !== id);
      toast('Tour deleted.');
      paintTours();
      refreshOverviewStats();
    } catch (error) {
      toastError(error, 'Could not delete this tour.');
    }
  };

  const deleteEvent = async (id) => {
    const event = data.events.find((item) => item.id === id);
    const ok = await confirmDelete('Delete this event?', `${event?.title || 'This event'} will be removed from the city guide.`, 'Delete event');
    if (!ok) return;
    try {
      await api(`/admin/events/${id}`, { method: 'DELETE' });
      data.events = data.events.filter((item) => item.id !== id);
      toast('Event deleted.');
      paintEvents();
    } catch (error) {
      toastError(error, 'Could not delete this event.');
    }
  };

  const setEventStatus = async (id, status) => {
    try {
      const event = data.events.find((item) => item.id === id);
      const updated = await api(`/admin/events/${id}`, {
        method: 'PATCH',
        body: {
          title: event.title,
          description: event.description,
          venue: event.venue,
          lat: event.lat,
          lng: event.lng,
          starts_at: event.starts_at,
          ends_at: event.ends_at,
          category: event.category,
          price: event.price,
          status,
        },
      });
      data.events = data.events.map((item) => (item.id === id ? updated : item));
      toast(status === 'published' ? 'Event published.' : 'Event moved to draft.');
      paintEvents();
    } catch (error) {
      toastError(error, 'Could not update this event.');
    }
  };

  const deleteRoute = async (id) => {
    const route = data.routes.find((item) => item.id === id);
    const ok = await confirmDelete('Delete this route?', `${route?.name || 'This route'} will disappear from the city guide.`, 'Delete route');
    if (!ok) return;
    try {
      await api(`/admin/routes/${id}`, { method: 'DELETE' });
      data.routes = data.routes.filter((item) => item.id !== id);
      toast('Route deleted.');
      paintRoutes();
    } catch (error) {
      toastError(error, 'Could not delete this route.');
    }
  };

  const setRouteStatus = async (id, status) => {
    try {
      const route = data.routes.find((item) => item.id === id);
      const updated = await api(`/admin/routes/${id}`, {
        method: 'PATCH',
        body: {
          name: route.name,
          description: route.description,
          start_point: route.start_point,
          end_point: route.end_point,
          distance_km: route.distance_km,
          duration_min: route.duration_min,
          vehicle_class: route.vehicle_class,
          fare: route.fare,
          status,
        },
      });
      data.routes = data.routes.map((item) => (item.id === id ? updated : item));
      toast(status === 'active' ? 'Route activated.' : 'Route hidden from riders.');
      paintRoutes();
    } catch (error) {
      toastError(error, 'Could not update this route.');
    }
  };

  const deleteOutbox = async (id) => {
    const ok = await confirmDelete('Delete this email log entry?', 'Only the log entry is removed. Delivered email is not recalled.', 'Delete entry');
    if (!ok) return;
    try {
      await api(`/admin/email/outbox/${id}`, { method: 'DELETE' });
      if (data.email?.outbox) data.email.outbox = data.email.outbox.filter((item) => item.id !== id);
      toast('Email log entry removed.');
      paintEmail();
    } catch (error) {
      toastError(error, 'Could not remove this log entry.');
    }
  };

  const retryOutbox = async (id) => {
    try {
      const result = await api(`/admin/email/outbox/${id}/retry`, { method: 'POST', body: {} });
      if (result?.delivered) toast('Email delivered.');
      else if (result?.already_sent) toast('That email was already sent.');
      else if (result?.method === 'logged_offline') toast('Gmail is not connected — the message was written to data/emails.log.');
      else if (result?.queued) toast(`Retry failed again. Next attempt in about ${Math.max(1, Math.round((result.retry_in_ms || 0) / 60000))} min.`);
      else toast('Retry failed. Check the email settings.');
      await reloadTab('email', { quiet: true });
    } catch (error) {
      toastError(error, 'Could not retry this email.');
    }
  };

  const deleteSubscriber = async (id) => {
    const ok = await confirmDelete('Remove this subscriber?', 'They will stop receiving newsletter updates.', 'Remove subscriber');
    if (!ok) return;
    try {
      await api(`/admin/subscribers/${id}`, { method: 'DELETE' });
      data.subscribers = data.subscribers.filter((item) => item.id !== id);
      if (data.email) data.email.subscriber_count = data.subscribers.length;
      toast('Subscriber removed.');
      paintEmail();
    } catch (error) {
      toastError(error, 'Could not remove this subscriber.');
    }
  };

  /* ---------------------------------------------------------------- */
  /* Tabs & events                                                     */
  /* ---------------------------------------------------------------- */

  const showTab = (next, { updateUrl = true } = {}) => {
    if (!TABS.some((t) => t.key === next)) return;
    // Leaflet maps keep DOM listeners; drop the instance when the panel is hidden.
    if (next !== 'map') destroyAreaMap();
    tab = next;
    view.querySelectorAll('[data-tab]').forEach((button) => {
      const active = button.dataset.tab === next;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', String(active));
    });
    view.querySelectorAll('[data-panel]').forEach((panel) => {
      panel.hidden = panel.dataset.panel !== next;
    });
    if (updateUrl) {
      window.history.replaceState(null, '', `#/admin${next === 'overview' ? '' : `?tab=${next}`}`);
    }
    void loadTab(next);
  };

  pageEl.addEventListener('submit', async (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || form.id !== 'revenue-form') return;
    event.preventDefault();
    const values = new FormData(form);
    const button = form.querySelector('[data-revenue-save]');
    await withBusy(button, async () => {
      try {
        const result = await api('/admin/revenue', {
          method: 'PATCH',
          body: {
            model: String(values.get('model') || 'commission'),
            commission_rate: Number(values.get('commission_rate') || 0),
            incentive_rate: Number(values.get('incentive_rate') || 0),
          },
        });
        data.revenue = { ...data.revenue, config: result.config };
        toast(`Revenue model saved: ${result.config.model} · commission ${result.config.commission_rate}% · incentive ${result.config.incentive_rate}%`);
        await reloadTab('revenue', { quiet: false });
        loaded.delete('insights');
      } catch (error) {
        toastError(error, 'Could not save the revenue model.');
      }
    });
  });

  pageEl.addEventListener('click', async (event) => {
    const tabBtn = event.target.closest('[data-tab]');
    if (tabBtn) {
      showTab(tabBtn.dataset.tab);
      return;
    }

    if (event.target.closest('#admin-refresh')) {
      const button = event.target.closest('#admin-refresh');
      await withBusy(button, async () => {
        loaded.delete(tab);
        await loadTab(tab, { force: true });
        refreshOverviewStats();
        toast('Operations data refreshed.');
      });
      return;
    }

    const driverFilterBtn = event.target.closest('[data-driver-filter]');
    if (driverFilterBtn) {
      filters.drivers = driverFilterBtn.dataset.driverFilter;
      paintDrivers();
      return;
    }
    const bookingFilterBtn = event.target.closest('[data-booking-filter]');
    if (bookingFilterBtn) {
      filters.bookings = bookingFilterBtn.dataset.bookingFilter;
      paintBookings();
      return;
    }
    const tourFilterBtn = event.target.closest('[data-tour-filter]');
    if (tourFilterBtn) {
      filters.tours = tourFilterBtn.dataset.tourFilter;
      paintTours();
      return;
    }
    const eventFilterBtn = event.target.closest('[data-event-filter]');
    if (eventFilterBtn) {
      filters.events = eventFilterBtn.dataset.eventFilter;
      paintEvents();
      return;
    }
    const routeFilterBtn = event.target.closest('[data-route-filter]');
    if (routeFilterBtn) {
      filters.routes = routeFilterBtn.dataset.routeFilter;
      paintRoutes();
      return;
    }
    const reportFilterBtn = event.target.closest('[data-report-filter]');
    if (reportFilterBtn) {
      filters.reports = reportFilterBtn.dataset.reportFilter;
      await reloadTab('safety', { quiet: false });
      return;
    }
    const roleBtn = event.target.closest('[data-role-filter]');
    if (roleBtn) {
      filters.users = roleBtn.dataset.roleFilter;
      await reloadTab('users', { quiet: false });
      return;
    }

    const addUserBtn = event.target.closest('[data-add-user]');
    if (addUserBtn) {
      await openPersonModal({ role: 'customer' });
      return;
    }
    const addDriverBtn = event.target.closest('[data-add-driver]');
    if (addDriverBtn) {
      await openPersonModal({ role: 'driver' });
      return;
    }

    const driverStatusBtn = event.target.closest('[data-driver-status]');
    if (driverStatusBtn) {
      await setDriverStatus(driverStatusBtn.dataset.driverId, driverStatusBtn.dataset.driverStatus);
      return;
    }
    const driverEditBtn = event.target.closest('[data-driver-edit]');
    if (driverEditBtn) {
      const driver = data.drivers.find((item) => String(item.id) === String(driverEditBtn.dataset.driverEdit));
      if (driver) await editDriverModal(driver);
      return;
    }
    const driverDeleteBtn = event.target.closest('[data-driver-delete]');
    if (driverDeleteBtn) {
      await deleteDriver(driverDeleteBtn.dataset.driverDelete);
      return;
    }

    const userStatusBtn = event.target.closest('[data-user-status]');
    if (userStatusBtn) {
      const user = data.users.find((item) => String(item.id) === String(userStatusBtn.dataset.userId));
      await setUserStatus(Number(userStatusBtn.dataset.userId), userStatusBtn.dataset.userStatus, user?.name || 'This person');
      return;
    }
    const verifyBtn = event.target.closest('[data-user-verify]');
    if (verifyBtn) {
      await setUserVerified(Number(verifyBtn.dataset.userId), verifyBtn.dataset.userVerify === '1');
      return;
    }
    const userEditBtn = event.target.closest('[data-user-edit]');
    if (userEditBtn) {
      const person = data.users.find((item) => String(item.id) === String(userEditBtn.dataset.userEdit));
      if (person) await editUserModal(person);
      return;
    }
    const userDeleteBtn = event.target.closest('[data-user-delete]');
    if (userDeleteBtn) {
      await deleteUser(Number(userDeleteBtn.dataset.userDelete));
      return;
    }

    const bookingEditBtn = event.target.closest('[data-booking-edit]');
    if (bookingEditBtn) {
      const booking = data.bookings.find((item) => String(item.id) === String(bookingEditBtn.dataset.bookingEdit));
      if (booking) await editBookingModal(booking);
      return;
    }
    const bookingDeleteBtn = event.target.closest('[data-booking-delete]');
    if (bookingDeleteBtn) {
      await deleteBooking(Number(bookingDeleteBtn.dataset.bookingDelete));
      return;
    }

    const addTourBtn = event.target.closest('[data-add-tour]');
    if (addTourBtn) {
      await tourModal();
      return;
    }
    const tourEditBtn = event.target.closest('[data-tour-edit]');
    if (tourEditBtn) {
      const tour = data.tours.find((item) => String(item.id) === String(tourEditBtn.dataset.tourEdit));
      if (tour) await tourModal(tour);
      return;
    }
    const tourCancelBtn = event.target.closest('[data-tour-cancel]');
    if (tourCancelBtn) {
      await cancelTour(Number(tourCancelBtn.dataset.tourCancel));
      return;
    }
    const tourDeleteBtn = event.target.closest('[data-tour-delete]');
    if (tourDeleteBtn) {
      await deleteTour(Number(tourDeleteBtn.dataset.tourDelete));
      return;
    }

    const addEventBtn = event.target.closest('[data-add-event]');
    if (addEventBtn) {
      await eventModal();
      return;
    }
    const eventEditBtn = event.target.closest('[data-event-edit]');
    if (eventEditBtn) {
      const item = data.events.find((entry) => String(entry.id) === String(eventEditBtn.dataset.eventEdit));
      if (item) await eventModal(item);
      return;
    }
    const eventStatusBtn = event.target.closest('[data-event-status]');
    if (eventStatusBtn) {
      await setEventStatus(Number(eventStatusBtn.dataset.eventId), eventStatusBtn.dataset.eventStatus);
      return;
    }
    const eventDeleteBtn = event.target.closest('[data-event-delete]');
    if (eventDeleteBtn) {
      await deleteEvent(Number(eventDeleteBtn.dataset.eventDelete));
      return;
    }

    const addRouteBtn = event.target.closest('[data-add-route]');
    if (addRouteBtn) {
      await routeModal();
      return;
    }
    const routeEditBtn = event.target.closest('[data-route-edit]');
    if (routeEditBtn) {
      const route = data.routes.find((item) => String(item.id) === String(routeEditBtn.dataset.routeEdit));
      if (route) await routeModal(route);
      return;
    }
    const routeStatusBtn = event.target.closest('[data-route-status]');
    if (routeStatusBtn) {
      await setRouteStatus(Number(routeStatusBtn.dataset.routeId), routeStatusBtn.dataset.routeStatus);
      return;
    }
    const routeDeleteBtn = event.target.closest('[data-route-delete]');
    if (routeDeleteBtn) {
      await deleteRoute(Number(routeDeleteBtn.dataset.routeDelete));
      return;
    }

    const fareEditBtn = event.target.closest('[data-fare-edit]');
    if (fareEditBtn) {
      const fare = data.fares.find((item) => item.key === fareEditBtn.dataset.fareEdit);
      if (fare) await fareModal(fare);
      return;
    }

    const reportBtn = event.target.closest('[data-report-action]');
    if (reportBtn) {
      await resolveReport(Number(reportBtn.dataset.reportId), reportBtn.dataset.reportAction);
      return;
    }
    const reportDeleteBtn = event.target.closest('[data-report-delete]');
    if (reportDeleteBtn) {
      await deleteReport(Number(reportDeleteBtn.dataset.reportDelete));
      return;
    }

    const outboxRetryBtn = event.target.closest('[data-outbox-retry]');
    if (outboxRetryBtn) {
      await retryOutbox(Number(outboxRetryBtn.dataset.outboxRetry));
      return;
    }
    const outboxDeleteBtn = event.target.closest('[data-outbox-delete]');
    if (outboxDeleteBtn) {
      await deleteOutbox(Number(outboxDeleteBtn.dataset.outboxDelete));
      return;
    }
    const subscriberDeleteBtn = event.target.closest('[data-subscriber-delete]');
    if (subscriberDeleteBtn) {
      await deleteSubscriber(Number(subscriberDeleteBtn.dataset.subscriberDelete));
    }
  });

  pageEl.addEventListener('input', (event) => {
    const id = event.target.id;
    if (id === 'driver-search') {
      queries.drivers = event.target.value.trim().toLowerCase();
      keepFocus(paintDrivers, 'driver-search');
      return;
    }
    if (id === 'booking-search') {
      queries.bookings = event.target.value.trim().toLowerCase();
      keepFocus(paintBookings, 'booking-search');
      return;
    }
    if (id === 'tour-search') {
      queries.tours = event.target.value.trim().toLowerCase();
      keepFocus(paintTours, 'tour-search');
      return;
    }
    if (id === 'event-search') {
      queries.events = event.target.value.trim().toLowerCase();
      keepFocus(paintEvents, 'event-search');
      return;
    }
    if (id === 'route-search') {
      queries.routes = event.target.value.trim().toLowerCase();
      keepFocus(paintRoutes, 'route-search');
      return;
    }
    if (id === 'user-search') {
      queries.users = event.target.value.trim();
      window.clearTimeout(userTimer);
      userTimer = window.setTimeout(async () => {
        loaded.delete('users');
        await loadTab('users', { force: true });
        const input = $('#user-search', view);
        if (input) {
          input.focus({ preventScroll: true });
          input.setSelectionRange(input.value.length, input.value.length);
        }
      }, 320);
    }
  });

  // Paint the overview strip even when another tab is active so totals are never stale.
  await loadTab('overview');
  if (tab !== 'overview') await loadTab(tab);

  return () => {
    window.clearTimeout(userTimer);
    destroyAreaMap();
  };
}
