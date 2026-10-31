import { api } from '../api.js';
import { state } from '../store.js';
import { icon } from '../ui/icons.js';
import { esc, money, dateTime, statusBadge } from '../ui/format.js';
import { pageHead, emptyState, errorBlock, skeletons, statCard } from '../ui/layout.js';
import { rideCard, openRating, rideTimeline } from '../ui/booking.js';
import { openModal } from '../ui/modal.js';
import { toast, toastError } from '../ui/toast.js';
import { $, withBusy } from '../ui/dom.js';

const FILTERS = [
  { key: 'all', label: 'All trips' },
  { key: 'active', label: 'Active' },
  { key: 'completed', label: 'Completed' },
  { key: 'cancelled', label: 'Cancelled' },
];

export default async function renderTrips(view, ctx) {
  const user = state.user;
  let bookings = [];
  let filter = ctx.query.get('filter') || 'all';
  if (!FILTERS.some((f) => f.key === filter)) filter = 'all';

  view.innerHTML = `
    <section class="trips-page">
      ${pageHead({
        eyebrow: user.role === 'driver' ? 'Your driving history' : 'Everything you have taken',
        title: 'Trips & receipts',
        description: user.role === 'driver'
          ? 'Completed trips, active jobs and the fares attached to each one.'
          : 'Revisit a route, download a receipt or rate a driver you enjoyed.',
        actions: `<a class="btn btn-primary" href="${user.role === 'driver' ? '#/driver' : '#/ride'}">${icon(user.role === 'driver' ? 'grid' : 'plus', 17)} ${user.role === 'driver' ? 'Driver dashboard' : 'New ride'}</a>`,
      })}
      <div class="trip-summary" id="trip-summary"></div>

      <section class="panel trips-panel">
        <div class="tabs-row">
          <div class="tabs" role="tablist" aria-label="Filter trips">
            ${FILTERS.map((f) => `<button type="button" class="tab ${f.key === filter ? 'is-active' : ''}" data-filter="${f.key}" role="tab" aria-selected="${f.key === filter}">${esc(f.label)}</button>`).join('')}
          </div>
          <label class="search-field">
            ${icon('search', 15)}
            <input type="search" id="trip-search" placeholder="Search code or place" aria-label="Search trips" />
          </label>
        </div>
        <div id="trip-list" class="trip-list">${skeletons(3)}</div>
      </section>
    </section>
  `;

  const listEl = $('#trip-list', view);
  const summaryEl = $('#trip-summary', view);
  const searchEl = $('#trip-search', view);
  const role = user.role === 'driver' ? 'driver' : 'customer';

  try {
    const data = await api('/bookings?scope=all');
    bookings = data.bookings || [];
  } catch (error) {
    listEl.innerHTML = errorBlock(error.message, { id: 'trips-retry' });
    $('#trips-retry', listEl)?.addEventListener('click', () => void ctx.navigate('/trips'));
    return () => {};
  }

  const completed = bookings.filter((b) => b.status === 'completed');
  const active = bookings.filter((b) => ['requested', 'accepted', 'arriving', 'in_progress'].includes(b.status));
  const spent = completed.reduce((sum, b) => sum + (Number(b.fare) || 0), 0);
  const avg = completed.filter((b) => b.rating).length
    ? (completed.filter((b) => b.rating).reduce((s, b) => s + b.rating, 0) / completed.filter((b) => b.rating).length).toFixed(1)
    : '—';

  if (summaryEl) {
    summaryEl.innerHTML = [
      statCard({ label: 'Completed trips', value: String(completed.length), icon: 'check-circle', tone: 'green' }),
      statCard({ label: 'Active now', value: String(active.length), icon: 'navigation', tone: 'amber', hint: active.length ? 'Tap a live trip below' : 'No ride in progress' }),
      statCard({ label: user.role === 'driver' ? 'Earned (completed)' : 'Total on completed trips', value: money(spent), icon: 'wallet', tone: 'blue' }),
      statCard({ label: 'Average rating given', value: avg === '—' ? '—' : `${avg} ★`, icon: 'star', tone: 'violet' }),
    ].join('');
  }

  const draw = () => {
    const query = (searchEl?.value || '').trim().toLowerCase();
    const filtered = bookings.filter((b) => {
      if (filter === 'active' && !['requested', 'accepted', 'arriving', 'in_progress'].includes(b.status)) return false;
      if (filter === 'completed' && b.status !== 'completed') return false;
      if (filter === 'cancelled' && b.status !== 'cancelled') return false;
      if (!query) return true;
      return `${b.code} ${b.pickup} ${b.dropoff} ${b.driver?.name || ''} ${b.customer?.name || ''}`
        .toLowerCase()
        .includes(query);
    });

    if (!filtered.length) {
      listEl.innerHTML = emptyState({
        icon: filter === 'active' ? 'car' : 'route',
        title: filter === 'active' ? 'Nothing on the road right now' : 'No trips match this view',
        text: filter === 'active'
          ? 'When you book or accept a ride, it will show up here with live status.'
          : 'Try another filter, or start a new trip.',
        action: `<a class="btn btn-sm ${filter === 'active' ? 'btn-primary' : 'btn-ghost'}" href="${user.role === 'driver' ? '#/driver' : '#/ride'}">${user.role === 'driver' ? 'Open driver dashboard' : 'Book a ride'}</a>`,
      });
      return;
    }

    listEl.innerHTML = filtered.map((b) => rideCard(b, {
      role,
      href: `#/ride/${b.id}`,
      actions: `
        <div class="trip-card-actions">
          <button type="button" class="btn btn-xs btn-ghost" data-details="${b.id}">${icon('eye', 13)} Details</button>
          ${b.status === 'completed' && !b.rating && role === 'customer' ? `<button type="button" class="btn btn-xs btn-primary" data-rate="${b.id}">${icon('star', 13)} Rate</button>` : ''}
          ${b.status === 'completed' ? `<button type="button" class="btn btn-xs btn-ghost" data-receipt="${b.id}">${icon('ticket', 13)} Receipt</button>` : ''}
        </div>
      `,
    })).join('');
  };

  const find = (id) => bookings.find((b) => String(b.id) === String(id));

  const details = (booking) => {
    openModal({
      title: `Trip ${booking.code}`,
      eyebrow: dateTime(booking.created_at),
      size: 'md',
      body: `
        <div class="detail-grid">
          <div><span>Status</span>${statusBadge(booking.status)}</div>
          <div><span>Class</span><strong>${esc(booking.vehicle_class.toUpperCase())}</strong></div>
          <div><span>Distance</span><strong>${esc(booking.distance_km)} km</strong></div>
          <div><span>Duration</span><strong>${booking.duration_min} min</strong></div>
          <div><span>Fare</span><strong>${esc(money(booking.fare))}</strong></div>
          <div><span>Code</span><strong>${esc(booking.code)}</strong></div>
        </div>
        <div class="detail-route">
          <p><span class="dot start"></span>${esc(booking.pickup)}</p>
          <p><span class="dot end"></span>${esc(booking.dropoff)}</p>
        </div>
        ${booking.scheduled_for ? `<p class="modal-text">${icon('calendar', 14)} Scheduled for ${esc(dateTime(booking.scheduled_for))}</p>` : ''}
        ${booking.notes ? `<p class="modal-text">${icon('message', 14)} “${esc(booking.notes)}”</p>` : ''}
        ${booking.driver?.name ? `<p class="modal-text">${icon('car', 14)} Driver: <strong>${esc(booking.driver.name)}</strong> · ${esc(booking.driver.plate)}</p>` : ''}
        ${booking.rating ? `<p class="modal-text">${icon('star', 14)} Rated ${booking.rating}/5 ${booking.review ? `— “${esc(booking.review)}”` : ''}</p>` : ''}
        <div class="modal-timeline">${rideTimeline(booking.status)}</div>
      `,
      footer: `<a class="btn btn-ghost" href="#/ride/${booking.id}">Open live view ${icon('arrow-right', 14)}</a><button class="btn btn-primary" data-close>Close</button>`,
    }).footer?.querySelector('[data-close]')?.addEventListener('click', () => document.querySelector('.modal-overlay .modal-close')?.click());
  };

  const receipt = (booking) => {
    const modal = openModal({
      title: 'Trip receipt',
      eyebrow: `AddisGo · ${booking.code}`,
      size: 'sm',
      body: `
        <div class="receipt">
          <div class="receipt-head">
            <span class="receipt-mark">A</span>
            <div><strong>AddisGo</strong><small>Addis Ababa, Ethiopia</small></div>
            <span>${statusBadge(booking.status)}</span>
          </div>
          <div class="receipt-row"><span>Trip code</span><strong>${esc(booking.code)}</strong></div>
          <div class="receipt-row"><span>Date</span><span>${esc(dateTime(booking.completed_at || booking.created_at))}</span></div>
          <div class="receipt-row"><span>Pickup</span><span>${esc(booking.pickup)}</span></div>
          <div class="receipt-row"><span>Destination</span><span>${esc(booking.dropoff)}</span></div>
          <div class="receipt-row"><span>Class</span><span>${esc(booking.vehicle_class.toUpperCase())}</span></div>
          <div class="receipt-row"><span>Distance</span><span>${esc(booking.distance_km)} km · ${booking.duration_min} min</span></div>
          ${booking.driver?.name ? `<div class="receipt-row"><span>Driver</span><span>${esc(booking.driver.name)} · ${esc(booking.driver.plate)}</span></div>` : ''}
          <div class="receipt-total"><span>Total paid</span><strong>${esc(money(booking.fare))}</strong></div>
          <p class="receipt-foot">Fares in Ethiopian Birr. This receipt is generated from your AddisGo trip record.</p>
        </div>
      `,
      footer: `<button class="btn btn-ghost" data-print>${icon('download', 15)} Print</button><button class="btn btn-primary" data-close>Done</button>`,
    });
    modal.footer?.querySelector('[data-print]')?.addEventListener('click', () => window.print());
    modal.footer?.querySelector('[data-close]')?.addEventListener('click', () => document.querySelector('.modal-overlay .modal-close')?.click());
  };

  view.querySelectorAll('[data-filter]').forEach((btn) => {
    btn.addEventListener('click', () => {
      filter = btn.dataset.filter;
      view.querySelectorAll('[data-filter]').forEach((b) => {
        b.classList.toggle('is-active', b === btn);
        b.setAttribute('aria-selected', String(b === btn));
      });
      draw();
    });
  });
  searchEl?.addEventListener('input', draw);

  listEl.addEventListener('click', (event) => {
    const detailsBtn = event.target.closest('[data-details]');
    const rateBtn = event.target.closest('[data-rate]');
    const receiptBtn = event.target.closest('[data-receipt]');
    if (detailsBtn) {
      const booking = find(detailsBtn.dataset.details);
      if (booking) details(booking);
    } else if (rateBtn) {
      const booking = find(rateBtn.dataset.rate);
      if (booking) {
        openRating(booking, {
          onRated: (updated) => {
            bookings = bookings.map((b) => (b.id === updated.id ? updated : b));
            draw();
            window.dispatchEvent(new CustomEvent('notifications:refresh'));
          },
        });
      }
    } else if (receiptBtn) {
      const booking = find(receiptBtn.dataset.receipt);
      if (booking) receipt(booking);
    }
  });

  draw();
  return () => {};
}
