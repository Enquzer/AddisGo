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

export function driverCard(driver, { phone = null, distance = null, bookingCode = '', pickup = '' } = {}) {
  if (!driver) return '';
  const cls = vehicleClass(driver.vehicle_class);
  const cleanPhone = phone ? phone.replace(/[^0-9]/g, '') : '';
  const waText = encodeURIComponent(`Hi ${driver.name}, I am at ${pickup || 'pickup'} for AddisGo ride ${bookingCode}.`);
  const smsText = encodeURIComponent(`Hi ${driver.name}, waiting at ${pickup || 'pickup'} for trip ${bookingCode}.`);
  return `<div class="driver-card">
    ${avatar(driver, 52, 'driver-avatar')}
    <div class="driver-copy">
      <div class="driver-name-row">
        <strong>${esc(driver.name)}</strong>
        <span class="badge badge-soft tone-${cls.tone}">${icon(cls.short === 'E2' ? 'zap' : 'car', 12)} ${esc(cls.name)}</span>
      </div>
      <span>${stars(driver.rating, { count: driver.rating_count })}</span>
      <small>${esc(driver.make_model)} · ${esc(driver.color)} · <span class="plate-pill">${esc(driver.plate)}</span></small>
      ${distance !== null ? `<div class="driver-eta">${icon('navigation', 12)} <span>${esc(km(distance))} away · Heading to pickup</span></div>` : ''}
    </div>
    <div class="driver-connect-actions">
      ${phone ? `
        <a class="btn btn-xs btn-ghost driver-contact-btn" href="tel:${esc(phone)}" title="Direct Phone Call">${icon('phone', 14)} <span>Call</span></a>
        <a class="btn btn-xs btn-ghost driver-contact-btn whatsapp-btn" href="https://wa.me/${cleanPhone}?text=${waText}" target="_blank" rel="noopener noreferrer" title="Chat on WhatsApp">${icon('message', 14)} <span>WhatsApp</span></a>
        <a class="btn btn-xs btn-ghost driver-contact-btn" href="sms:${esc(phone)}?body=${smsText}" title="Send SMS Text">${icon('mail', 14)} <span>SMS</span></a>
      ` : ''}
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

/* --- Feedback modals ----------------------------------------------------- */

const ASPECTS = [
  { key: 'car_condition', label: 'Car condition', icon: 'car' },
  { key: 'comfort', label: 'Comfort', icon: 'sparkle' },
  { key: 'cleanliness', label: 'Tidiness', icon: 'check' },
  { key: 'service', label: 'Service', icon: 'user' },
  { key: 'safety', label: 'Safety', icon: 'shield' },
];

let feedbackOptions = null;

/** Reason codes and tag vocabularies live on the server; fetched once per session. */
async function loadFeedbackOptions() {
  if (!feedbackOptions) {
    try {
      feedbackOptions = await api('/public/cancel-reasons');
    } catch {
      feedbackOptions = { rider: [], driver: [], rating_tags: { rider: [], driver: [] } };
    }
  }
  return feedbackOptions;
}

function starButtons(value, size = 26) {
  return [1, 2, 3, 4, 5]
    .map((n) => `<button type="button" class="rating-star ${n <= value ? 'is-on' : ''}" data-score="${n}" aria-label="${n} star${n > 1 ? 's' : ''}">${icon('star', size)}</button>`)
    .join('');
}

/**
 * Two-sided rating modal.
 *
 *  role 'rider'  → driver score with car/comfort/tidiness/service/safety rows.
 *  role 'driver' → rider score with rider tags only.
 *
 * Punctuality is not a question: it is derived from the arrival telemetry and
 * shown back to the rider so the score is never a surprise.
 */
export async function openRating(booking, { onRated, role = 'rider' } = {}) {
  const isDriver = role === 'driver';
  const options = await loadFeedbackOptions();
  const tagList = options.rating_tags?.[isDriver ? 'driver' : 'rider'] ?? [];

  let overall = 5;
  const aspectScores = Object.fromEntries(ASPECTS.map((aspect) => [aspect.key, 0]));
  const selectedTags = new Set();

  const delay = booking.arrival_delay_min;
  const punctuality = isDriver
    ? ''
    : `<div class="rate-punctuality">
        ${icon('clock', 14)}
        ${delay == null
          ? '<span>Arrival timing was not recorded for this trip.</span>'
          : delay <= 0
            ? '<span>Arrived on time. Punctuality is scored automatically.</span>'
            : `<span>Arrived <strong>${delay} min</strong> after the promised ETA. Punctuality is scored automatically.</span>`}
      </div>`;

  const aspectRows = isDriver
    ? ''
    : `<div class="rate-aspects">
        ${ASPECTS.map((aspect) => `
          <div class="rate-row" data-aspect="${aspect.key}">
            <span class="rate-row-label">${icon(aspect.icon, 14)} ${esc(aspect.label)}</span>
            <div class="rating-input rating-input-sm" role="radiogroup" aria-label="${esc(aspect.label)}">${starButtons(0, 18)}</div>
          </div>
        `).join('')}
      </div>`;

  const modal = openModal({
    title: isDriver ? 'How was your rider?' : 'How was your ride?',
    eyebrow: `Trip ${booking.code}`,
    size: 'sm',
    body: `
      <p class="modal-text">${isDriver ? 'Riders with good scores get matched faster.' : 'Your feedback keeps the fleet safe and accountable.'}</p>
      <div class="rate-overall">
        <span class="rate-row-label">${icon('star', 14)} Overall</span>
        <div class="rating-input" role="radiogroup" aria-label="Overall rating" data-overall>${starButtons(overall, 30)}</div>
      </div>
      ${aspectRows}
      ${punctuality}
      ${tagList.length ? `
        <div class="rate-tags" role="group" aria-label="What stood out">
          <span class="rate-row-label">What stood out <em>(optional)</em></span>
          <div class="tag-chips">
            ${tagList.map((tag) => `<button type="button" class="tag-chip" data-tag="${esc(tag.code)}" aria-pressed="false">${esc(tag.label)}</button>`).join('')}
          </div>
        </div>
      ` : ''}
      <label class="field">
        <span class="field-label">A note ${isDriver ? 'for your rider' : 'for your driver'} <em>(optional)</em></span>
        <textarea class="field-input" name="review" rows="3" maxlength="400" placeholder="${isDriver ? 'Ready on time, easy pickup…' : 'Safe driving, clean car, friendly welcome…'}"></textarea>
      </label>
    `,
    footer: `
      <button type="button" class="btn btn-ghost" data-act="later">Not now</button>
      <button type="button" class="btn btn-primary" data-act="submit">Submit rating</button>
    `,
  });

  const overallGroup = modal.body.querySelector('[data-overall]');
  overallGroup.querySelectorAll('[data-score]').forEach((btn) => {
    btn.addEventListener('click', () => {
      overall = Number(btn.dataset.score);
      overallGroup.querySelectorAll('[data-score]').forEach((b) => {
        b.classList.toggle('is-on', Number(b.dataset.score) <= overall);
      });
    });
  });

  modal.body.querySelectorAll('[data-aspect]').forEach((row) => {
    const key = row.dataset.aspect;
    row.querySelectorAll('[data-score]').forEach((btn) => {
      btn.addEventListener('click', () => {
        aspectScores[key] = Number(btn.dataset.score);
        row.querySelectorAll('[data-score]').forEach((b) => {
          b.classList.toggle('is-on', Number(b.dataset.score) <= aspectScores[key]);
        });
        row.classList.add('is-rated');
      });
    });
  });

  modal.body.querySelectorAll('[data-tag]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const code = btn.dataset.tag;
      if (selectedTags.has(code)) selectedTags.delete(code);
      else selectedTags.add(code);
      btn.classList.toggle('is-on', selectedTags.has(code));
      btn.setAttribute('aria-pressed', String(selectedTags.has(code)));
    });
  });

  modal.footer.querySelector('[data-act="later"]')?.addEventListener('click', () => modal.close());
  modal.footer.querySelector('[data-act="submit"]')?.addEventListener('click', async (event) => {
    const review = modal.body.querySelector('[name="review"]').value.trim();
    const body = { rating: overall, review, tags: [...selectedTags] };
    if (!isDriver) {
      for (const aspect of ASPECTS) {
        if (aspectScores[aspect.key] > 0) body[aspect.key] = aspectScores[aspect.key];
      }
    }
    await withBusy(event.currentTarget, async () => {
      try {
        const updated = await api(`/bookings/${booking.id}/rate`, { method: 'POST', body });
        modal.close();
        toast('Thanks for the feedback!');
        onRated?.(updated);
      } catch (error) {
        toastError(error);
      }
    });
  });
}

/**
 * Cancellation modal with coded reasons.
 *
 * For a driver the trip is not cancelled: it is released and automatically
 * re-offered, so the copy says exactly that instead of "the rider must rebook".
 */
export async function openCancel(booking, { role = 'rider', onCancelled } = {}) {
  const isDriver = role === 'driver';
  const isAdmin = role === 'admin';
  const options = await loadFeedbackOptions();
  const reasons = (isDriver ? options.driver : options.rider) ?? [];
  let selected = null;

  const modal = openModal({
    title: isDriver ? 'Release this trip?' : 'Cancel this ride?',
    eyebrow: `Trip ${booking.code}`,
    size: 'sm',
    body: `
      <p class="modal-text">${isDriver
        ? 'Tell us why you cannot complete this trip. It will be offered to another driver automatically — the rider keeps their booking.'
        : isAdmin
          ? 'The rider and driver will both be notified. Pick the reason that best matches what happened.'
          : 'Tell us why you are cancelling. Your answer is linked to the trip so we can fix what went wrong.'}</p>
      <div class="reason-list" role="radiogroup" aria-label="Cancellation reason">
        ${reasons.map((reason) => `
          <button type="button" class="reason-option" data-code="${esc(reason.code)}" role="radio" aria-checked="false">
            <span class="reason-dot" aria-hidden="true"></span>
            <span class="reason-label">${esc(reason.label)}</span>
            ${reason.fee ? '<span class="reason-fee">fee may apply</span>' : ''}
          </button>
        `).join('')}
      </div>
      <label class="field">
        <span class="field-label">Anything else? <em>(optional)</em></span>
        <textarea class="field-input" name="note" rows="2" maxlength="200" placeholder="Add a short note…"></textarea>
      </label>
    `,
    footer: `
      <button type="button" class="btn btn-ghost" data-act="keep">${isDriver ? 'Keep trip' : 'Keep ride'}</button>
      <button type="button" class="btn btn-danger" data-act="confirm">${isDriver ? 'Release trip' : 'Cancel ride'}</button>
    `,
  });

  modal.body.querySelectorAll('[data-code]').forEach((btn) => {
    btn.addEventListener('click', () => {
      selected = btn.dataset.code;
      modal.body.querySelectorAll('[data-code]').forEach((b) => {
        const on = b === btn;
        b.classList.toggle('is-on', on);
        b.setAttribute('aria-checked', String(on));
      });
    });
  });

  modal.footer.querySelector('[data-act="keep"]')?.addEventListener('click', () => modal.close());
  modal.footer.querySelector('[data-act="confirm"]')?.addEventListener('click', async (event) => {
    if (!selected) {
      toast('Choose a reason first.');
      return;
    }
    const note = modal.body.querySelector('[name="note"]').value.trim();
    await withBusy(event.currentTarget, async () => {
      try {
        const updated = await api(`/bookings/${booking.id}/cancel`, {
          method: 'POST',
          body: { reason_code: selected, reason: note },
        });
        modal.close();
        toast(isDriver ? 'Trip released. We are finding another driver.' : 'Ride cancelled.');
        onCancelled?.(updated);
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
