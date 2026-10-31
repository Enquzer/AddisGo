import { api } from '../api.js';
import { state, refreshMe } from '../store.js';
import { icon } from '../ui/icons.js';
import {
  esc, money, km, minutes, dateTime, relative, avatar, stars, statusBadge,
  vehicleClass, plural,
} from '../ui/format.js';
import { pageHead, sectionHead, emptyState, errorBlock, skeletons, statCard } from '../ui/layout.js';
import { rideCard, routeLine } from '../ui/booking.js';
import { RideMap, locateUser } from '../ui/map.js';
import { openModal } from '../ui/modal.js';
import { toast, toastError } from '../ui/toast.js';
import { $, withBusy, formValues } from '../ui/dom.js';
import { createPoller } from '../ui/poll.js';
import { ADDIS_CENTER } from '../places.js';

const TABS = [
  { key: 'overview', label: 'Overview', icon: 'grid' },
  { key: 'requests', label: 'Requests', icon: 'car' },
  { key: 'vehicle', label: 'Vehicle', icon: 'settings' },
  { key: 'verify', label: 'Verify pass', icon: 'qr' },
];

const CLASS_KEYS = [
  { key: 'e2', label: 'Electric E2', hint: 'Quiet zero-tailpipe city car · 4 seats' },
  { key: 'comfort', label: 'Comfort', hint: 'Extra room and a smoother ride · 4 seats' },
  { key: 'van', label: 'Tour Van', hint: 'Groups and luggage · 7 seats' },
  { key: 'bajaj', label: 'Bajaj', hint: 'Quick neighbourhood hops · 3 seats' },
];

export default async function renderDriver(view, ctx) {
  let tab = ctx.query.get('tab') || 'overview';
  if (!TABS.some((t) => t.key === tab)) tab = 'overview';

  view.innerHTML = `
    <section class="driver-page">
      ${pageHead({
        eyebrow: 'Driver mode',
        title: 'Your driving day.',
        description: 'Go online, accept nearby requests and keep every trip and earning in one place.',
        actions: `
          <button type="button" class="btn btn-ghost" id="driver-refresh">${icon('refresh', 16)} Refresh</button>
          <button type="button" class="btn btn-primary online-toggle" id="online-toggle" disabled>
            ${icon('power', 17)} <span>Loading…</span>
          </button>
        `,
      })}

      <div id="driver-alert"></div>
      <div class="stat-strip stat-strip-driver" id="driver-stats">${skeletons(4, 'stat-skeleton')}</div>

      <section class="panel driver-shell">
        <div class="tabs driver-tabs" role="tablist" aria-label="Driver dashboard sections">
          ${TABS.map((t) => `
            <button type="button" class="tab ${t.key === tab ? 'is-active' : ''}" role="tab"
              data-tab="${t.key}" aria-selected="${t.key === tab}" aria-controls="driver-panel-${t.key}">
              ${icon(t.icon, 15)} ${esc(t.label)}
            </button>
          `).join('')}
        </div>

        <div class="tab-panels">
          <section class="tab-panel" id="driver-panel-overview" data-panel="overview" role="tabpanel">
            <div id="driver-overview">${skeletons(2, 'line-skeleton')}</div>
          </section>
          <section class="tab-panel" id="driver-panel-requests" data-panel="requests" role="tabpanel" hidden>
            <div id="driver-requests">${skeletons(2, 'line-skeleton')}</div>
          </section>
          <section class="tab-panel" id="driver-panel-vehicle" data-panel="vehicle" role="tabpanel" hidden>
            <div id="driver-vehicle">${skeletons(2, 'line-skeleton')}</div>
          </section>
          <section class="tab-panel" id="driver-panel-verify" data-panel="verify" role="tabpanel" hidden>
            <div id="driver-verify"></div>
          </section>
        </div>
      </section>
    </section>
  `;

  const alertEl = $('#driver-alert', view);
  const statsEl = $('#driver-stats', view);
  const overviewEl = $('#driver-overview', view);
  const requestsEl = $('#driver-requests', view);
  const vehicleEl = $('#driver-vehicle', view);
  const verifyEl = $('#driver-verify', view);
  const onlineBtn = $('#online-toggle', view);

  let driver = null;
  let stats = null;
  let activeTrips = [];
  let requests = [];
  let loadingRequests = false;
  let recentChecks = [];
  let requestsPoller = null;
  let tickCount = 0;
  let destroyed = false;

  /* ---------------------------------------------------------------- */
  /* Initial load                                                      */
  /* ---------------------------------------------------------------- */

  try {
    const [meResult, tripsResult] = await Promise.allSettled([
      api('/driver/me'),
      api('/bookings?scope=active'),
    ]);
    if (meResult.status === 'rejected') throw meResult.reason;
    driver = meResult.value.driver;
    stats = meResult.value.stats;
    activeTrips = tripsResult.status === 'fulfilled' ? tripsResult.value.bookings || [] : [];
  } catch (error) {
    view.innerHTML = `<div class="panel narrow-panel">
      ${errorBlock(error.message, { id: 'driver-retry' })}
      <a class="btn btn-ghost" href="#/">${icon('arrow-left', 15)} Back home</a>
      <a class="btn btn-ghost" href="#/register">Apply to drive</a>
    </div>`;
    $('#driver-retry', view)?.addEventListener('click', () => void ctx.navigate('/driver'));
    return () => {};
  }

  const approved = driver.status === 'approved';

  const paintStatus = () => {
    if (!driver) return;
    onlineBtn.disabled = !approved;
    onlineBtn.classList.toggle('is-online', Boolean(driver.is_online));
    onlineBtn.classList.toggle('btn-primary', !driver.is_online);
    onlineBtn.classList.toggle('btn-ghost', Boolean(driver.is_online));
    onlineBtn.innerHTML = `${icon('power', 17)} <span>${driver.is_online ? 'Go offline' : 'Go online'}</span>`;
    onlineBtn.setAttribute('aria-pressed', String(Boolean(driver.is_online)));

    if (!approved) {
      alertEl.innerHTML = `
        <div class="notice notice-${driver.status === 'suspended' ? 'danger' : 'warning'}" role="status">
          <span class="notice-icon">${icon(driver.status === 'suspended' ? 'ban' : 'clock', 20)}</span>
          <div>
            <strong>${driver.status === 'suspended' ? 'Your driver account is paused' : 'Your application is in review'}</strong>
            <p>${driver.status === 'suspended'
              ? 'Go to your profile to review your details or email support@addisgo.et to appeal. You cannot accept rides while suspended.'
              : 'Our team reviews every vehicle and licence before approval. You can update your vehicle details now — we will notify you the moment you are approved.'}</p>
          </div>
          <a class="btn btn-sm btn-ghost" href="#/profile">Open profile</a>
        </div>`;
    } else if (!driver.is_online) {
      alertEl.innerHTML = `
        <div class="notice notice-info" role="status">
          <span class="notice-icon">${icon('navigation', 20)}</span>
          <div><strong>You are offline</strong><p>Go online to share your location and see ride requests within 35 km of you.</p></div>
        </div>`;
    } else {
      alertEl.innerHTML = '';
    }
  };

  const paintStats = () => {
    if (!stats) return;
    statsEl.innerHTML = [
      statCard({ label: 'Today', value: money(stats.earnings_today), hint: 'Completed fares', icon: 'wallet', tone: 'green' }),
      statCard({ label: 'This week', value: money(stats.earnings_week), hint: 'Rolling 7 days', icon: 'trending-up', tone: 'blue' }),
      statCard({ label: 'Active trip', value: stats.active_bookings ? plural(stats.active_bookings, 'trip') : 'None', hint: stats.active_bookings ? 'Open it now' : 'Ready for the next one', icon: 'car', tone: stats.active_bookings ? 'amber' : 'violet' }),
      statCard({ label: 'Lifetime', value: money(stats.earnings_total), hint: `${plural(stats.trips_total, 'trip')} completed`, icon: 'award', tone: 'amber' }),
    ].join('');
  };

  /* ---------------------------------------------------------------- */
  /* Overview                                                          */
  /* ---------------------------------------------------------------- */

  const paintOverview = () => {
    if (!driver) return;
    const cls = vehicleClass(driver.vehicle_class);
    const statusCopy = approved
      ? driver.is_online
        ? 'Online and visible to riders nearby.'
        : 'Offline. Go online when you are ready to drive.'
      : driver.status === 'suspended'
        ? 'Suspended — contact support to appeal.'
        : 'Waiting for approval from our operations team.';

    overviewEl.innerHTML = `
      <div class="driver-overview-grid">
        <div class="driver-overview-main">
          <section class="panel driver-status-card ${driver.is_online ? 'is-online' : ''}">
            <div class="driver-status-head">
              <span class="online-orb ${driver.is_online ? 'is-on' : ''}" aria-hidden="true"></span>
              <div>
                <h2>${driver.is_online ? 'You are online' : 'You are offline'}</h2>
                <p>${esc(statusCopy)}</p>
              </div>
              ${statusBadge(driver.status)}
            </div>
            <div class="driver-identity">
              ${avatar(state.user, 48)}
              <div>
                <strong>${esc(state.user.name)}</strong>
                <small>${stars(driver.rating, { count: driver.rating_count })}</small>
              </div>
              <span class="badge badge-soft tone-${cls.tone}">${icon(cls.short === 'E2' ? 'zap' : 'car', 13)} ${esc(cls.name)}</span>
            </div>
            <dl class="driver-facts">
              <div><dt>Vehicle</dt><dd>${esc(driver.make_model)}</dd></div>
              <div><dt>Plate</dt><dd class="plate">${esc(driver.plate)}</dd></div>
              <div><dt>Colour</dt><dd>${esc(driver.color || '—')}</dd></div>
              <div><dt>Trips</dt><dd>${esc(String(driver.trips))}</dd></div>
            </dl>
            ${driver.approved_at ? `<p class="fine-print">${icon('check-circle', 13)} Approved ${esc(relative(driver.approved_at))}</p>` : ''}
          </section>

          <section class="panel">
            ${sectionHead('Active trips', {
              description: activeTrips.length ? 'Finish the trip in progress before accepting another.' : 'No trip in progress right now.',
              action: '<a class="text-link" href="#/trips">All trips ' + icon('arrow-right', 14) + '</a>',
            })}
            <div id="active-trip-list" class="ride-list">${renderActiveTrips()}</div>
          </section>

          <section class="panel">
            ${sectionHead('Latest requests', {
              description: 'Requests refresh every few seconds while you are online.',
              action: '<button type="button" class="text-link" data-goto-tab="requests">View all ' + icon('arrow-right', 14) + '</button>',
            })}
            <div id="overview-request-list">${renderRequestPreview()}</div>
          </section>
        </div>

        <aside class="driver-overview-side">
          <section class="panel">
            <h2 class="panel-title">Next steps</h2>
            <ul class="task-list">
              <li class="${approved ? 'is-done' : ''}">${icon(approved ? 'check-circle' : 'clock', 16)} <span>Driver application approved</span></li>
              <li class="${driver.is_online ? 'is-done' : ''}">${icon(driver.is_online ? 'check-circle' : 'power', 16)} <span>Go online with your location</span></li>
              <li class="${driver.trips > 0 ? 'is-done' : ''}">${icon(driver.trips > 0 ? 'check-circle' : 'car', 16)} <span>Complete your first trip</span></li>
              <li>${icon('qr', 16)} <span>Verify the rider's pass code at pickup</span></li>
            </ul>
          </section>

          <section class="panel">
            ${sectionHead('Quick actions')}
            <div class="stack-actions">
              <button type="button" class="btn btn-ghost btn-block" data-goto-tab="requests">${icon('car', 16)} See ride requests</button>
              <button type="button" class="btn btn-ghost btn-block" data-goto-tab="verify">${icon('qr', 16)} Verify a pass</button>
              <button type="button" class="btn btn-ghost btn-block" data-goto-tab="vehicle">${icon('settings', 16)} Update vehicle</button>
            </div>
          </section>

          <section class="panel trust-panel">
            <span class="trust-icon">${icon('shield', 20)}</span>
            <div>
              <strong>Safety comes first</strong>
              <p>Rider contact details stay hidden until you accept a trip. Report anything unusual and our safety desk will step in.</p>
              <a class="text-link" href="#/profile">Safety centre ${icon('arrow-right', 14)}</a>
            </div>
          </section>
        </aside>
      </div>
    `;

    paintActiveTrips();
    paintRequestPreview();
  };

  const renderActiveTrips = () => {
    if (!activeTrips.length) {
      return emptyState({
        icon: 'car',
        title: 'No active trip',
        text: approved
          ? 'Go online and accept a request to see the pickup here.'
          : 'Once you are approved, you can start accepting trips.',
      });
    }
    return activeTrips.map((trip) => {
      const actions = [];
      if (trip.status === 'accepted') {
        actions.push(`<button type="button" class="btn btn-sm btn-primary" data-trip="${trip.id}" data-next="arriving">${icon('navigation', 14)} I'm arriving</button>`);
        actions.push(`<button type="button" class="btn btn-sm btn-ghost" data-trip="${trip.id}" data-next="in_progress">${icon('car', 14)} Start</button>`);
      } else if (trip.status === 'arriving') {
        actions.push(`<button type="button" class="btn btn-sm btn-primary" data-trip="${trip.id}" data-next="in_progress">${icon('car', 14)} Start trip</button>`);
      } else if (trip.status === 'in_progress') {
        actions.push(`<button type="button" class="btn btn-sm btn-primary" data-trip="${trip.id}" data-next="completed">${icon('check', 14)} Complete</button>`);
      }
      actions.push(`<a class="btn btn-sm btn-ghost" href="#/ride/${trip.id}">${icon('eye', 14)} Open trip</a>`);
      const rider = trip.customer ? `Rider: ${esc(trip.customer.name)}${trip.customer_phone ? ` · ${esc(trip.customer_phone)}` : ''}` : '';
      return rideCard(trip, {
        role: 'driver',
        actions: `${rider ? `<p class="ride-contact">${icon('phone', 14)} ${rider}</p>` : ''}${actions.join('')}`,
      });
    }).join('');
  };

  const renderRequestPreview = () => {
    if (!approved) {
      return `<p class="muted">Requests unlock once your application is approved.</p>`;
    }
    if (!driver.is_online) {
      return `<p class="muted">${icon('power', 15)} Go online to see requests near you.</p>`;
    }
    if (!requests.length) {
      return `<p class="muted">${icon('clock', 15)} Scanning for requests within 35 km… Keep this page open.</p>`;
    }
    return requests.slice(0, 2).map((r) => requestCard(r, { compact: true })).join('');
  };

  const paintActiveTrips = () => {
    const host = $('#active-trip-list', view);
    if (host) host.innerHTML = renderActiveTrips();
  };

  const paintRequestPreview = () => {
    const host = $('#overview-request-list', view);
    if (host) host.innerHTML = renderRequestPreview();
  };

  const requestCard = (request, { compact = false } = {}) => {
    const cls = vehicleClass(request.vehicle_class);
    const when = request.scheduled_for ? `Scheduled ${dateTime(request.scheduled_for)}` : dateTime(request.created_at);
    return `<article class="request-card ${compact ? 'is-compact' : ''}">
      <div class="request-top">
        <span class="ride-class tone-${cls.tone}">${icon(cls.short === 'E2' ? 'zap' : 'car', 15)} ${esc(cls.name)}</span>
        <span class="request-distance">${icon('navigation', 13)} ${esc(km(request.driver_distance_km))} to pickup · ${esc(minutes(request.pickup_eta_min))}</span>
      </div>
      ${routeLine(request.pickup, request.dropoff, { compact: true })}
      <div class="request-meta">
        <span>${icon('calendar', 13)} ${esc(when)}</span>
        <span>${icon('route', 13)} ${esc(km(request.distance_km))} · ${esc(minutes(request.duration_min))}</span>
        <strong>${esc(money(request.fare))}</strong>
      </div>
      ${request.notes ? `<p class="request-note">${icon('info', 13)} ${esc(request.notes)}</p>` : ''}
      <div class="request-actions">
        <span class="request-rider">${avatar(request.customer, 28)} ${esc(request.customer.name)}</span>
        <button type="button" class="btn btn-sm btn-primary" data-accept="${request.id}">${icon('check', 14)} Accept ride</button>
      </div>
    </article>`;
  };

  /* ---------------------------------------------------------------- */
  /* Requests tab                                                      */
  /* ---------------------------------------------------------------- */

  const paintRequests = () => {
    if (!driver) return;
    if (!approved) {
      requestsEl.innerHTML = emptyState({
        icon: driver.status === 'suspended' ? 'ban' : 'clock',
        title: driver.status === 'suspended' ? 'Account suspended' : 'Application in review',
        text: driver.status === 'suspended'
          ? 'You cannot accept rides while your account is suspended. Contact support@addisgo.et for a review.'
          : 'Our team is checking your licence and vehicle. We will notify you as soon as you are approved.',
        action: '<button type="button" class="btn btn-sm btn-ghost" data-goto-tab="vehicle">Review vehicle details</button>',
      });
      return;
    }
    if (!driver.is_online) {
      requestsEl.innerHTML = emptyState({
        icon: 'power',
        title: 'You are offline',
        text: 'Share your location and go online to receive trip requests within 35 km.',
        action: `<button type="button" class="btn btn-sm btn-primary" data-go-online>${icon('power', 15)} Go online</button>`,
      });
      return;
    }
    if (loadingRequests && !requests.length) {
      requestsEl.innerHTML = skeletons(2, 'card-skeleton');
      return;
    }
    if (!requests.length) {
      requestsEl.innerHTML = emptyState({
        icon: 'navigation',
        title: 'No requests right now',
        text: 'You are online and visible to riders. New requests appear here automatically — usually within a few minutes.',
        action: `<button type="button" class="btn btn-sm btn-ghost" data-refresh-requests>${icon('refresh', 15)} Check again</button>`,
      });
      return;
    }
    requestsEl.innerHTML = `
      <div class="requests-head">
        <div>
          <h2>${plural(requests.length, 'request')} near you</h2>
          <p>Sorted by scheduled time, then distance. Rider phone numbers unlock when you accept.</p>
        </div>
        <button type="button" class="btn btn-sm btn-ghost" data-refresh-requests>${icon('refresh', 15)} Refresh</button>
      </div>
      <div class="request-list">${requests.map((r) => requestCard(r)).join('')}</div>
    `;
  };

  const loadRequests = async ({ quiet = false } = {}) => {
    if (!driver || !approved || !driver.is_online) {
      requests = [];
      paintRequests();
      paintRequestPreview();
      return;
    }
    if (loadingRequests) return;
    loadingRequests = true;
    if (!quiet && tab === 'requests') paintRequests();
    try {
      const data = await api('/driver/requests');
      requests = data.requests || [];
    } catch (error) {
      requests = [];
      if (!quiet) toastError(error, 'Could not load requests.');
    } finally {
      loadingRequests = false;
      if (destroyed) return;
      paintRequests();
      paintRequestPreview();
    }
  };

  /* ---------------------------------------------------------------- */
  /* Vehicle tab                                                       */
  /* ---------------------------------------------------------------- */

  const paintVehicle = () => {
    if (!driver) return;
    vehicleEl.innerHTML = `
      <form class="form vehicle-form" id="vehicle-form" novalidate>
        <div class="form-alert" id="vehicle-error" role="alert" hidden></div>
        <div class="panel-head-row">
          <div>
            <h2>Vehicle &amp; licence</h2>
            <p>Keep this accurate — riders see your vehicle before pickup, and operations use it for verification.</p>
          </div>
          ${statusBadge(driver.status)}
        </div>

        <div class="field-grid">
          <label class="field field-wide">
            <span class="field-label">Vehicle class</span>
            <select class="field-input" name="vehicle_class">
              ${CLASS_KEYS.map((c) => `<option value="${c.key}" ${c.key === driver.vehicle_class ? 'selected' : ''}>${esc(c.label)} — ${esc(c.hint)}</option>`).join('')}
            </select>
          </label>
          <label class="field">
            <span class="field-label">Make and model</span>
            <input class="field-input" name="make_model" maxlength="60" value="${esc(driver.make_model)}" placeholder="BYD Dolphin" required />
          </label>
          <label class="field">
            <span class="field-label">Plate number</span>
            <input class="field-input" name="plate" maxlength="20" value="${esc(driver.plate)}" placeholder="AA 2-12345" required />
          </label>
          <label class="field">
            <span class="field-label">Colour</span>
            <input class="field-input" name="color" maxlength="30" value="${esc(driver.color || '')}" placeholder="Pearl white" />
          </label>
          <label class="field">
            <span class="field-label">Driving licence</span>
            <input class="field-input" name="license_no" maxlength="30" value="${esc(driver.license_no)}" required />
            <span class="field-hint">Shown only to AddisGo operations, never to riders.</span>
          </label>
        </div>

        <div class="form-actions">
          <button type="submit" class="btn btn-primary" id="vehicle-save">${icon('check', 16)} Save vehicle</button>
          <span class="muted">Changes do not interrupt an active trip.</span>
        </div>
      </form>
    `;

    const form = $('#vehicle-form', vehicleEl);
    const errorBox = $('#vehicle-error', vehicleEl);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      errorBox.hidden = true;
      const values = formValues(form);
      const button = $('#vehicle-save', vehicleEl);
      await withBusy(button, async () => {
        try {
          const me = await api('/driver/profile', {
            method: 'PATCH',
            body: {
              vehicle_class: values.vehicle_class,
              make_model: values.make_model,
              plate: values.plate,
              color: values.color,
              license_no: values.license_no,
            },
          });
          driver = me.driver;
          if (stats) stats.trips_total = driver.trips;
          toast('Vehicle details saved.');
          try { await refreshMe(); } catch { /* local state is already current */ }
        } catch (error) {
          errorBox.hidden = false;
          errorBox.innerHTML = `${icon('info', 16)} <span>${esc(error.message)}</span>`;
        }
      });
    });
  };

  /* ---------------------------------------------------------------- */
  /* Verify tab                                                        */
  /* ---------------------------------------------------------------- */

  const paintVerify = () => {
    verifyEl.innerHTML = `
      <div class="verify-grid">
        <section class="verify-form-card">
          <div class="panel-head-row">
            <div>
              <h2>Verify a rider's pass</h2>
              <p>Ask the rider for their code or scan the QR pass. Enter the code exactly as shown.</p>
            </div>
            ${icon('qr', 26)}
          </div>
          <form class="form" id="verify-code-form" novalidate>
            <label class="field">
              <span class="field-label">Check-in code</span>
              <input class="field-input code-input" name="code" placeholder="AG-XXXXXX" maxlength="20"
                autocomplete="off" autocapitalize="characters" spellcheck="false" required />
              <span class="field-hint">The code starts with AG- and is printed under the rider's QR.</span>
            </label>
            <button type="submit" class="btn btn-primary">${icon('check-circle', 16)} Verify pass</button>
          </form>
          <div id="verify-result" class="verify-result" aria-live="polite"></div>
        </section>

        <aside class="verify-side">
          <section class="panel">
            <h2 class="panel-title">Checks this session</h2>
            <div id="verify-history">${renderHistory()}</div>
          </section>
          <section class="panel trust-panel">
            <span class="trust-icon">${icon('shield', 20)}</span>
            <div>
              <strong>Why we check</strong>
              <p>The pass proves the right rider is in the right car. If a code does not match, ask the rider to refresh their app before starting the trip.</p>
            </div>
          </section>
        </aside>
      </div>
    `;

    const form = $('#verify-code-form', verifyEl);
    const resultEl = $('#verify-result', verifyEl);
    const input = form.querySelector('[name="code"]');
    input?.focus();

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const code = String(input.value || '').trim().toUpperCase();
      if (!code) {
        input.classList.add('is-invalid');
        input.focus();
        return;
      }
      const button = form.querySelector('button[type="submit"]');
      resultEl.innerHTML = '';
      await withBusy(button, async () => {
        try {
          const data = await api('/driver/verify', { method: 'POST', body: { code } });
          const booking = data.booking;
          recentChecks = [
            { code: booking.code, name: booking.customer?.name || 'Rider', at: new Date().toISOString(), ok: true, id: booking.id },
            ...recentChecks,
          ].slice(0, 6);
          resultEl.innerHTML = `
            <div class="verify-ok">
              <span class="verify-ok-icon">${icon('check-circle', 26)}</span>
              <div>
                <strong>Pass verified</strong>
                <p>${esc(booking.customer?.name || 'Your rider')} · ${esc(booking.code)}</p>
                <p class="muted">${esc(booking.pickup)} → ${esc(booking.dropoff)}</p>
              </div>
              <a class="btn btn-sm btn-primary" href="#/ride/${booking.id}">${icon('arrow-right', 14)} Open trip</a>
            </div>`;
          input.value = '';
          paintHistory();
          toast('Pass verified. You can start the trip.');
        } catch (error) {
          recentChecks = [
            { code, name: error.message, at: new Date().toISOString(), ok: false },
            ...recentChecks,
          ].slice(0, 6);
          resultEl.innerHTML = `<div class="verify-fail">${icon('ban', 20)} <span>${esc(error.message)}</span></div>`;
          paintHistory();
          toastError(error, 'That code could not be verified.');
        }
      });
    });
  };

  function renderHistory() {
    if (!recentChecks.length) {
      return `<p class="muted">No codes checked yet. Verifications you make this session appear here.</p>`;
    }
    return `<ul class="verify-history">
      ${recentChecks.map((check) => `
        <li class="${check.ok ? 'is-ok' : 'is-fail'}">
          <span class="verify-history-icon">${icon(check.ok ? 'check-circle' : 'ban', 16)}</span>
          <span><strong>${esc(check.code)}</strong><small>${esc(check.name)}</small></span>
          <small>${esc(relative(check.at))}</small>
        </li>
      `).join('')}
    </ul>`;
  }

  function paintHistory() {
    const host = $('#verify-history', verifyEl);
    if (host) host.innerHTML = renderHistory();
  }

  /* ---------------------------------------------------------------- */
  /* Online / location                                                 */
  /* ---------------------------------------------------------------- */

  const chooseLocation = async () => {
    try {
      return await locateUser();
    } catch (error) {
      if (driver.lat != null && driver.lng != null) {
        toast(`${error.message} Using your last shared position — you can move the pin.`, { type: 'warning', duration: 6000 });
        return pickOnMap({ lat: Number(driver.lat), lng: Number(driver.lng) }, true);
      }
      toast(error.message, { type: 'warning', duration: 6000 });
      return pickOnMap(ADDIS_CENTER, false);
    }
  };

  const pickOnMap = (center, canConfirm) => new Promise((resolve) => {
    let point = canConfirm ? { ...center } : null;
    let settled = false;
    const modal = openModal({
      title: 'Set your location',
      eyebrow: 'Driver mode',
      size: 'lg',
      body: `
        <p class="modal-text">Riders see you on the map from this pin. Tap the map to place yourself at your current parking spot.</p>
        <div id="driver-location-map" class="driver-location-map" aria-label="Choose your current location"></div>
        <div class="location-actions">
          <button type="button" class="btn btn-ghost" id="use-location">${icon('navigation', 15)} Use current location</button>
          <span class="muted" id="location-readout">${point ? `${point.lat.toFixed(4)}, ${point.lng.toFixed(4)}` : 'No point selected yet'}</span>
        </div>
      `,
      footer: `
        <button type="button" class="btn btn-ghost" data-close>Cancel</button>
        <button type="button" class="btn btn-primary" data-confirm disabled>${icon('check', 15)} Use this spot</button>
      `,
      onClose: () => {
        if (!settled) {
          settled = true;
          resolve(null);
        }
      },
    });

    const map = new RideMap(modal.body.querySelector('#driver-location-map'), { center: point || center, zoom: 14 });
    const readout = modal.body.querySelector('#location-readout');
    const confirmBtn = modal.footer.querySelector('[data-confirm]');

    const setPoint = (lat, lng, { pan = false } = {}) => {
      point = { lat, lng };
      readout.textContent = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
      confirmBtn.disabled = false;
      if (map.ready) {
        map.setCar(lat, lng);
        if (pan) map.panTo(lat, lng, 14);
      }
    };

    if (point) setPoint(point.lat, point.lng);
    map.onPick('driver', (next) => setPoint(next.lat, next.lng));

    modal.body.querySelector('#use-location').addEventListener('click', async (event) => {
      const button = event.currentTarget;
      await withBusy(button, async () => {
        try {
          const pos = await locateUser();
          setPoint(pos.lat, pos.lng, { pan: true });
        } catch (error) {
          toast(error.message, { type: 'warning' });
        }
      });
    });

    const finish = (value) => {
      if (settled) return;
      settled = true;
      modal.close();
      resolve(value);
    };
    confirmBtn.addEventListener('click', () => {
      if (!point) return;
      finish(point);
    });
    modal.footer.querySelector('[data-close]').addEventListener('click', () => finish(null));

    const originalClose = modal.close;
    modal.close = () => {
      map.destroy();
      originalClose();
    };
  });

  const startPoller = () => {
    if (requestsPoller || destroyed) return;
    requestsPoller = createPoller(async () => {
      tickCount += 1;
      if (tab === 'requests' || tab === 'overview') {
        await loadRequests({ quiet: true });
      }
      if (tickCount % 3 === 0) {
        try {
          const data = await api('/driver/me');
          if (destroyed) return;
          driver = data.driver;
          stats = data.stats;
          paintStatus();
          paintStats();
        } catch {
          /* keep the last known stats */
        }
      }
    }, 7000);
  };

  const stopPoller = () => {
    requestsPoller?.stop();
    requestsPoller = null;
  };

  const setOnline = async (next) => {
    if (!approved) {
      toast('Your driver application must be approved before going online.', { type: 'warning' });
      return;
    }
    onlineBtn.disabled = true;
    onlineBtn.innerHTML = '<span class="spinner spinner-sm"></span><span>Working…</span>';
    try {
      let lat = driver.lat;
      let lng = driver.lng;
      if (next) {
        const pos = await chooseLocation();
        if (!pos) return;
        lat = pos.lat;
        lng = pos.lng;
      }
      const updated = await api('/driver/status', {
        method: 'PATCH',
        body: next ? { is_online: true, lat, lng } : { is_online: false },
      });
      driver = updated;
      requests = [];
      paintStatus();
      paintOverview();
      paintRequests();
      if (next) {
        startPoller();
        toast('You are online. Watching for nearby requests.');
        await loadRequests({ quiet: true });
      } else {
        stopPoller();
        toast('You are offline. No new requests will arrive.', { type: 'info' });
      }
    } catch (error) {
      toastError(error);
    } finally {
      if (!destroyed) {
        onlineBtn.disabled = !approved;
        paintStatus();
      }
    }
  };

  /* ---------------------------------------------------------------- */
  /* Tabs & global events                                              */
  /* ---------------------------------------------------------------- */

  const reloadAll = async ({ quiet = false } = {}) => {
    try {
      const [meResult, tripsResult] = await Promise.all([
        api('/driver/me'),
        api('/bookings?scope=active'),
      ]);
      driver = meResult.driver;
      stats = meResult.stats;
      activeTrips = tripsResult.bookings || [];
      if (!quiet) toast('Dashboard updated.');
      paintStatus();
      paintStats();
      paintOverview();
      paintVehicle();
      if (driver.is_online) await loadRequests({ quiet: true });
      else paintRequests();
      paintVerify();
    } catch (error) {
      if (!quiet) toastError(error, 'Could not refresh the dashboard.');
    }
  };

  const showTab = (next, { updateUrl = true } = {}) => {
    if (!TABS.some((t) => t.key === next)) return;
    tab = next;
    view.querySelectorAll('[data-tab]').forEach((btn) => {
      const active = btn.dataset.tab === next;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-selected', String(active));
    });
    view.querySelectorAll('[data-panel]').forEach((panel) => {
      panel.hidden = panel.dataset.panel !== next;
    });
    if (updateUrl) {
      window.history.replaceState(null, '', `#/driver${next === 'overview' ? '' : `?tab=${next}`}`);
    }
    if (next === 'requests') void loadRequests();
    if (next === 'overview') {
      paintOverview();
      if (driver.is_online) void loadRequests({ quiet: true });
    }
  };

  const onViewClick = async (event) => {
    const tabBtn = event.target.closest('[data-tab]');
    if (tabBtn) {
      showTab(tabBtn.dataset.tab);
      return;
    }
    const goto = event.target.closest('[data-goto-tab]');
    if (goto) {
      showTab(goto.dataset.gotoTab);
      return;
    }
    if (event.target.closest('[data-go-online]')) {
      await setOnline(true);
      return;
    }
    if (event.target.closest('[data-refresh-requests]')) {
      await loadRequests();
      return;
    }
    if (event.target.closest('#driver-refresh')) {
      await reloadAll();
      return;
    }

    const acceptBtn = event.target.closest('[data-accept]');
    if (acceptBtn) {
      await withBusy(acceptBtn, async () => {
        try {
          const booking = await api(`/bookings/${acceptBtn.dataset.accept}/accept`, { method: 'POST' });
          toast('Ride accepted. Head to the pickup point.');
          ctx.navigate(`/ride/${booking.id}`);
        } catch (error) {
          toastError(error, 'That request may have just been taken.');
          await loadRequests({ quiet: true });
        }
      });
      return;
    }

    const tripBtn = event.target.closest('[data-trip]');
    if (tripBtn) {
      const next = tripBtn.dataset.next;
      await withBusy(tripBtn, async () => {
        try {
          const updated = await api(`/bookings/${tripBtn.dataset.trip}/status`, {
            method: 'PATCH',
            body: { status: next },
          });
          activeTrips = activeTrips.map((t) => (t.id === updated.id ? updated : t));
          if (updated.status === 'completed') {
            activeTrips = activeTrips.filter((t) => t.id !== updated.id);
            toast('Trip completed. Great work.');
            await reloadAll({ quiet: true });
          } else {
            toast(next === 'arriving' ? 'Rider notified that you are arriving.' : 'Trip started. Safe travels.');
            paintOverview();
          }
          if (stats) stats.active_bookings = activeTrips.length;
          paintStats();
          window.dispatchEvent(new CustomEvent('notifications:refresh'));
        } catch (error) {
          toastError(error);
          await reloadAll({ quiet: true });
        }
      });
    }
  };

  view.addEventListener('click', onViewClick);

  const onVisible = () => {
    if (document.hidden) return;
    void loadRequests({ quiet: true });
  };
  document.addEventListener('visibilitychange', onVisible);

  onlineBtn.addEventListener('click', () => void setOnline(!driver.is_online));

  paintStatus();
  paintStats();
  paintOverview();
  paintRequests();
  paintVehicle();
  paintVerify();

  if (driver.is_online) {
    void loadRequests({ quiet: true });
    startPoller();
  }

  return () => {
    destroyed = true;
    stopPoller();
    view.removeEventListener('click', onViewClick);
    document.removeEventListener('visibilitychange', onVisible);
  };
}
