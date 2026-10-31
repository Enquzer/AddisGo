import { icon } from './icons.js';
import {
  esc, money, km, minutes, dateTime, avatar, stars, statusBadge, vehicleClass, relative, countdown,
} from './format.js';
import { api } from '../api.js';
import { openModal } from './modal.js';
import { toast, toastError } from './toast.js';
import { withBusy } from './dom.js';

const FLOW = ['requested', 'accepted', 'arriving', 'in_progress', 'completed'];

export function rideTimeline(status) {
  if (status === 'cancelled') {
    return `<div class="ride-cancelled">${icon('ban', 16)} This ride was cancelled</div>`;
  }
  const current = FLOW.indexOf(status);
  const labels = ['Requested', 'Driver found', 'Arriving', 'On the way', 'Complete'];
  return `<ol class="timeline" aria-label="Ride progress">
    ${FLOW.map((step, index) => `
      <li class="timeline-step ${index < current ? 'is-done' : ''} ${index === current ? 'is-current' : ''}">
        <span class="timeline-dot">${index < current ? icon('check', 11) : ''}</span>
        <span class="timeline-label">${labels[index]}</span>
      </li>
    `).join('')}
  </ol>`;
}

export function routeLine(from, to, { compact = false } = {}) {
  return `<div class="route-line ${compact ? 'is-compact' : ''}">
    <span class="route-node is-start" aria-hidden="true"></span>
    <span class="route-track" aria-hidden="true"></span>
    <span class="route-node is-end" aria-hidden="true"></span>
    <div class="route-places">
      <p>${esc(from)}</p>
      <p>${esc(to)}</p>
    </div>
  </div>`;
}

export function rideCard(booking, { role = 'customer', href = null, actions = '' } = {}) {
  const cls = vehicleClass(booking.vehicle_class);
  const person = role === 'customer'
    ? (booking.driver ? { name: booking.driver.name, color: booking.driver.avatar_color, sub: `${booking.driver.make_model} · ${booking.driver.plate}` } : null)
    : { name: booking.customer?.name || 'Rider', color: booking.customer?.avatar_color, sub: booking.customer_phone || 'Contact hidden' };
  const when = booking.scheduled_for && booking.status === 'requested'
    ? `Scheduled ${dateTime(booking.scheduled_for)}`
    : dateTime(booking.created_at);
  return `<article class="ride-card ${booking.status === 'cancelled' ? 'is-muted' : ''}">
    <div class="ride-card-top">
      <span class="ride-class tone-${cls.tone}">${icon(cls.short === 'E2' ? 'zap' : 'car', 16)} ${esc(cls.name)}</span>
      ${statusBadge(booking.status)}
    </div>
    ${routeLine(booking.pickup, booking.dropoff, { compact: true })}
    <div class="ride-card-meta">
      <span>${icon('calendar', 14)} ${esc(when)}</span>
      <span>${icon('route', 14)} ${esc(km(booking.distance_km))} · ${esc(minutes(booking.duration_min))}</span>
      <strong class="ride-fare">${esc(money(booking.fare))}</strong>
    </div>
    ${person ? `<div class="ride-person">
      ${avatar(person, 32)}
      <div><strong>${esc(person.name || 'Matching you…')}</strong><small>${esc(person.sub || '')}</small></div>
      ${booking.rating ? stars(booking.rating) : ''}
    </div>` : ''}
    ${actions ? `<div class="ride-card-actions">${actions}</div>` : ''}
    ${href ? `<a class="card-link" href="${href}" aria-label="Open ride ${esc(booking.pickup)} to ${esc(booking.dropoff)}">View ride ${icon('chevron-right', 15)}</a>` : ''}
  </article>`;
}

export function driverCard(driver, { phone = null, distance = null } = {}) {
  if (!driver) return '';
  const cls = vehicleClass(driver.vehicle_class);
  return `<div class="driver-card">
    ${avatar(driver, 48)}
    <div class="driver-copy">
      <strong>${esc(driver.name)}</strong>
      <span>${stars(driver.rating, { count: driver.rating_count })}</span>
      <small>${esc(driver.make_model)} · ${esc(driver.color)} · ${esc(driver.plate)}</small>
    </div>
    <div class="driver-side">
      <span class="badge badge-soft tone-${cls.tone}">${icon(cls.short === 'E2' ? 'zap' : 'car', 13)} ${esc(cls.name)}</span>
      ${distance !== null ? `<small>${esc(km(distance))} away</small>` : ''}
      ${phone ? `<a class="btn btn-xs btn-ghost" href="tel:${esc(phone)}">${icon('phone', 13)} Call</a>` : ''}
    </div>
  </div>`;
}

export function classPicker(classes, selected, estimates = {}, { name = 'vehicle_class' } = {}) {
  return `<div class="class-grid" role="radiogroup" aria-label="Ride class">
    ${classes.map((cls) => {
      const est = estimates[cls.key];
      return `<label class="class-option ${cls.key === selected ? 'is-selected' : ''}">
        <input type="radio" name="${name}" value="${cls.key}" ${cls.key === selected ? 'checked' : ''} />
        <span class="class-option-icon tone-${cls.tone}">${icon(cls.key === 'e2' ? 'zap' : cls.key === 'van' ? 'users' : cls.key === 'bajaj' ? 'navigation' : 'car', 20)}</span>
        <span class="class-option-copy">
          <strong>${esc(cls.name)}</strong>
          <small>${esc(cls.tagline)}</small>
          <em>${esc(cls.seats)} seats</em>
        </span>
        <span class="class-option-fare">${est ? money(est.fare) : '—'}<small>${est ? minutes(est.duration_min) : ''}</small></span>
      </label>`;
    }).join('')}
  </div>`;
}

export function openRating(booking, { onRated } = {}) {
  let score = 5;
  const modal = openModal({
    title: 'How was your ride?',
    eyebrow: `Trip ${booking.code}`,
    size: 'sm',
    body: `
      <p class="modal-text">Your feedback helps riders and drivers trust each other.</p>
      <div class="rating-input" role="radiogroup" aria-label="Star rating">
        ${[1, 2, 3, 4, 5].map((n) => `<button type="button" class="rating-star ${n <= score ? 'is-on' : ''}" data-score="${n}" aria-label="${n} star${n > 1 ? 's' : ''}">${icon('star', 30)}</button>`).join('')}
      </div>
      <label class="field">
        <span class="field-label">A note for your driver <em>(optional)</em></span>
        <textarea class="field-input" name="review" rows="3" maxlength="400" placeholder="Safe driving, clean car, friendly welcome…"></textarea>
      </label>
    `,
    footer: `
      <button type="button" class="btn btn-ghost" data-act="later">Not now</button>
      <button type="button" class="btn btn-primary" data-act="submit">Submit rating</button>
    `,
  });

  modal.body.querySelectorAll('[data-score]').forEach((btn) => {
    btn.addEventListener('click', () => {
      score = Number(btn.dataset.score);
      modal.body.querySelectorAll('[data-score]').forEach((b) => {
        b.classList.toggle('is-on', Number(b.dataset.score) <= score);
      });
    });
  });

  modal.footer.querySelector('[data-act="later"]')?.addEventListener('click', () => modal.close());
  modal.footer.querySelector('[data-act="submit"]')?.addEventListener('click', async (event) => {
    const review = modal.body.querySelector('[name="review"]').value.trim();
    await withBusy(event.currentTarget, async () => {
      try {
        const updated = await api(`/bookings/${booking.id}/rate`, {
          method: 'POST',
          body: { rating: score, review },
        });
        modal.close();
        toast('Thanks for the feedback!');
        onRated?.(updated);
      } catch (error) {
        toastError(error);
      }
    });
  });
}

export function themeImage(theme) {
  const images = {
    entoto: '/assets/tours/entoto.jpg',
    merkato: '/assets/tours/merkato.jpg',
    museum: '/assets/tours/museum.jpg',
    bole: '/assets/tours/bole.jpg',
    custom: '/assets/tours/custom.jpg',
  };
  return images[theme] || images.custom;
}

export function tourCard(tour, { href = null } = {}) {
  const filled = tour.member_count || 1;
  const pct = Math.min(100, Math.round((filled / Math.max(1, tour.capacity)) * 100));
  const imgSrc = tour.image_url || themeImage(tour.theme);
  return `<article class="tour-card">
    <div class="tour-media theme-${esc(tour.theme || 'custom')}">
      <img src="${esc(imgSrc)}" alt="${esc(tour.title)}" class="tour-media-photo" loading="lazy" />
      <div class="tour-media-overlay" aria-hidden="true"></div>
      <span class="tour-theme">${icon(themeIcon(tour.theme), 15)} ${esc(themeLabel(tour.theme))}</span>
      <span class="tour-price">${tour.price === 0 ? 'Free' : money(tour.price)}</span>
    </div>
    <div class="tour-body">
      <div class="tour-when">${icon('calendar', 14)} ${esc(dateTime(tour.starts_at))} ${tour.status === 'upcoming' ? `<em>· ${esc(countdown(tour.starts_at))}</em>` : statusBadge(tour.status)}</div>
      <h3>${esc(tour.title)}</h3>
      <p class="tour-desc">${esc(tour.description)}</p>
      <div class="tour-meta">
        <span>${icon('map-pin', 14)} ${esc(tour.meeting_point)}</span>
        <span>${icon('clock', 14)} ${esc(minutes(tour.duration_min))}</span>
      </div>
      <div class="tour-progress">
        <div class="progress"><span style="width:${pct}%"></span></div>
        <small>${tour.spots_left > 0 ? `${tour.spots_left} of ${tour.capacity} spots left` : 'Full'}</small>
      </div>
      <div class="tour-foot">
        <div class="tour-host">
          ${avatar(tour.host, 30)}
          <span><strong>${esc(tour.host.name)}</strong><small>${esc((tour.host.languages || []).slice(0, 2).join(' · '))}</small></span>
        </div>
        ${href ? `<a class="btn btn-sm btn-ghost" href="${href}">View tour ${icon('chevron-right', 14)}</a>` : ''}
      </div>
    </div>
  </article>`;
}

export function themeIcon(theme) {
  return {
    entoto: 'leaf', merkato: 'map-pin', museum: 'award', bole: 'compass', custom: 'compass',
  }[theme] || 'compass';
}

export function themeLabel(theme) {
  return {
    entoto: 'Nature & views', merkato: 'Markets & food', museum: 'History & culture',
    bole: 'Modern Addis', custom: 'Local pick',
  }[theme] || 'City tour';
}

export function memberList(members, hostId) {
  if (!members?.length) return '<p class="muted">No one has joined yet.</p>';
  return `<ul class="member-list">
    ${members.map((m) => `<li>${avatar(m, 30)}<span>${esc(m.name)}${m.id === hostId ? ' <em class="host-tag">Host</em>' : ''}</span></li>`).join('')}
  </ul>`;
}
