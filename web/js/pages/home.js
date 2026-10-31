import { api } from '../api.js';
import { state } from '../store.js';
import { icon } from '../ui/icons.js';
import {
  esc, money, km, minutes, dateTime, time, relative, avatar, stars, statusBadge,
  greeting, vehicleClass, date, plural,
} from '../ui/format.js';
import { pageHead, sectionHead, emptyState, statCard, skeletons } from '../ui/layout.js';
import { rideCard, rideTimeline, driverCard, tourCard } from '../ui/booking.js';
import { RideMap, locateUser } from '../ui/map.js';
import { toast, toastError } from '../ui/toast.js';
import { $ } from '../ui/dom.js';
import { ADDIS_CENTER } from '../places.js';
import renderLanding from './landing.js';

export default async function renderHome(view, ctx) {
  if (ctx.route?.path === '/dashboard') {
    return renderDashboard(view, ctx);
  }
  return renderLanding(view, ctx);
}

async function renderDashboard(view, ctx) {
  if (!state.user) {
    return renderLanding(view, ctx);
  }

  const user = state.user;
  const firstName = user.name.split(' ')[0];

  view.innerHTML = `
    <section class="home-page">
      ${pageHead({
        eyebrow: `${greeting()}, ${firstName}`,
        title: user.role === 'driver' ? 'Your driving day, at a glance.' : 'Where are we going today?',
        description: user.role === 'driver'
          ? 'Go online to see nearby requests, manage active trips and keep your earnings in view.'
          : 'Book an electric ride, catch a small-group tour, or pick up where you left off.',
        actions: `<a class="btn btn-primary" href="${user.role === 'driver' ? '#/driver' : '#/ride'}">${icon(user.role === 'driver' ? 'power' : 'car', 17)} ${user.role === 'driver' ? 'Driver dashboard' : 'Book a ride'}</a>
          <a class="btn btn-ghost" href="#/tours">${icon('compass', 17)} Browse tours</a>`,
      })}

      <div class="home-grid">
        <div class="home-main">
          <section class="panel live-panel" id="active-ride">
            <div class="panel-loading">${skeletons(1, 'line-skeleton')}</div>
          </section>

          <section class="quick-grid" aria-label="Quick actions">
            <a class="quick-card tone-green" href="#/ride">
              <span class="quick-icon">${icon('car', 22)}</span>
              <strong>Book a ride</strong>
              <small>Electric E2, comfort or van</small>
              ${icon('arrow-up-right', 16, 'quick-arrow')}
            </a>
            <a class="quick-card tone-amber" href="#/tours">
              <span class="quick-icon">${icon('compass', 22)}</span>
              <strong>Join a city tour</strong>
              <small>Small groups with local hosts</small>
              ${icon('arrow-up-right', 16, 'quick-arrow')}
            </a>
            <a class="quick-card tone-blue" href="#/trips">
              <span class="quick-icon">${icon('route', 22)}</span>
              <strong>Trips &amp; receipts</strong>
              <small>Everything you have taken</small>
              ${icon('arrow-up-right', 16, 'quick-arrow')}
            </a>
            <a class="quick-card tone-violet" href="#/profile">
              <span class="quick-icon">${icon('shield', 22)}</span>
              <strong>Safety centre</strong>
              <small>Contacts, reports and privacy</small>
              ${icon('arrow-up-right', 16, 'quick-arrow')}
            </a>
          </section>

          <section class="panel">
            ${sectionHead('Recent trips', { action: '<a class="text-link" href="#/trips">All trips ' + icon('arrow-right', 14) + '</a>' })}
            <div id="recent-trips">${skeletons(2)}</div>
          </section>
        </div>

        <aside class="home-side">
          <section class="panel map-panel">
            <div class="panel-head-row">
              <div><h2>Drivers near you</h2><p id="nearby-meta">Finding your bearings…</p></div>
              <button type="button" class="btn btn-xs btn-ghost" id="locate-btn">${icon('navigation', 14)} Locate</button>
            </div>
            <div id="home-map" class="home-map" aria-label="Map of nearby drivers"></div>
            <div class="map-foot">
              <a class="text-link" href="#/ride">Book from the map ${icon('arrow-right', 14)}</a>
              <span class="map-legend"><span class="legend-dot"></span> Online drivers</span>
            </div>
          </section>

          <section class="panel">
            ${sectionHead('Your calendar', { action: '<a class="text-link" href="#/tours">Tours ' + icon('chevron-right', 14) + '</a>' })}
            <div id="home-tours">${skeletons(2)}</div>
          </section>

          <section class="panel trust-panel">
            <span class="trust-icon">${icon('shield', 20)}</span>
            <div>
              <strong>Ride with confidence</strong>
              <p>Every driver is reviewed by our team. Your phone number stays private until a driver accepts.</p>
              <a class="text-link" href="#/profile">Safety tools ${icon('arrow-right', 14)}</a>
            </div>
          </section>
        </aside>
      </div>
    </section>
  `;

  const cleanups = [];
  const activeEl = $('#active-ride', view);
  const recentEl = $('#recent-trips', view);
  const toursEl = $('#home-tours', view);
  const mapEl = $('#home-map', view);
  const nearbyMeta = $('#nearby-meta', view);
  let map = null;

  // Active ride + recent trips
  try {
    const [activeData, recentData, mineData, statsData] = await Promise.allSettled([
      api('/bookings?scope=active'),
      api('/bookings?scope=recent'),
      api('/tours?mine=1'),
      user.role === 'driver' ? api('/driver/me') : Promise.resolve(null),
    ]);

    const active = activeData.status === 'fulfilled' ? activeData.value.bookings || [] : [];
    const recent = recentData.status === 'fulfilled' ? recentData.value.bookings || [] : [];
    const mine = mineData.status === 'fulfilled' ? mineData.value.tours || [] : [];
    const driverProfile = statsData.status === 'fulfilled' ? statsData.value : null;

    if (activeEl) {
      if (active.length) {
        activeEl.innerHTML = renderActiveRide(active[0], user);
      } else {
        activeEl.classList.add('is-empty');
        activeEl.innerHTML = `
          <div class="live-empty">
            <span class="live-empty-icon">${icon('car', 24)}</span>
            <div>
              <h2>No ride in progress</h2>
              <p>Your next trip is one tap away. Fares are shown before you book.</p>
            </div>
            <a class="btn btn-sm btn-primary" href="#/ride">Request a ride</a>
          </div>
        `;
      }
    }

    if (recentEl) {
      recentEl.innerHTML = recent.length
        ? recent.slice(0, 3).map((b) => rideCard(b, { role: user.role === 'driver' ? 'driver' : 'customer', href: `#/ride/${b.id}` })).join('')
        : emptyState({
            icon: 'route',
            title: 'No trips yet',
            text: 'Your receipts and ratings will appear here after your first ride.',
            action: '<a class="btn btn-sm btn-primary" href="#/ride">Book your first ride</a>',
          });
    }

    if (toursEl) {
      const upcoming = mine.filter((t) => t.status === 'upcoming').slice(0, 2);
      toursEl.innerHTML = upcoming.length
        ? upcoming.map((t) => `
            <a class="mini-tour" href="#/tour/${t.id}">
              <span class="mini-tour-date theme-${esc(t.theme)}"><strong>${esc(date(t.starts_at).split(',')[0])}</strong><small>${esc(time(t.starts_at))}</small></span>
              <span class="mini-tour-copy"><strong>${esc(t.title)}</strong><small>${esc(t.meeting_point)} · ${t.is_host ? 'You host' : `${t.member_count} going`}</small></span>
              ${icon('chevron-right', 15)}
            </a>
          `).join('')
        : emptyState({
            icon: 'compass',
            title: 'Nothing booked yet',
            text: 'Join a small-group tour and meet Addis with a local host.',
            action: '<a class="btn btn-sm btn-ghost" href="#/tours">Find a tour</a>',
          });
    }

    if (driverProfile) {
      // Drivers get their live stats in the dashboard, not here — keep home light.
    }

    if (active.length && mapEl) {
      const ride = active[0];
      map = new RideMap(mapEl, { center: { lat: ride.pickup_lat, lng: ride.pickup_lng }, zoom: 13 });
      if (map.ready) {
        map.setPickup({ lat: ride.pickup_lat, lng: ride.pickup_lng, label: 'Pickup' });
        map.setDropoff({ lat: ride.dropoff_lat, lng: ride.dropoff_lng, label: 'Destination' });
        map.fitPoints([[ride.pickup_lat, ride.pickup_lng], [ride.dropoff_lat, ride.dropoff_lng]]);
        if (ride.driver?.lat && ride.driver?.lng) {
          map.setCar(ride.driver.lat, ride.driver.lng);
          map.fitAll();
        }
      }
    } else if (mapEl) {
      map = new RideMap(mapEl, { center: ADDIS_CENTER, zoom: 12 });
      void loadNearby(ADDIS_CENTER, false);
    }

    $('#locate-btn', view)?.addEventListener('click', async () => {
      try {
        const pos = await locateUser();
        if (map?.ready) {
          map.setUser(pos.lat, pos.lng);
          map.panTo(pos.lat, pos.lng, 13);
        }
        await loadNearby(pos, true);
      } catch (error) {
        toast(error.message, { type: 'warning', duration: 5000 });
      }
    });
  } catch (error) {
    if (activeEl) {
      activeEl.innerHTML = `<div class="inline-error">${icon('info', 18)} Could not load your rides right now.</div>`;
    }
    console.error(error);
  }

  async function loadNearby(center, move) {
    try {
      const data = await api(`/drivers/nearby?lat=${center.lat}&lng=${center.lng}${user.driver ? `&class=${encodeURIComponent(user.driver.vehicle_class)}` : ''}`);
      const drivers = data.drivers || [];
      if (nearbyMeta) {
        nearbyMeta.textContent = drivers.length
          ? `${plural(drivers.length, 'driver')} online within range`
          : 'No drivers online right now — try again shortly';
      }
      if (map?.ready) {
        map.setDrivers(drivers, {
          onSelect: (driver) => toast(`${driver.name} · ${driver.make_model} · ${km(driver.distance_km)} away`, { type: 'info' }),
        });
        if (move) map.fitAll();
      }
    } catch {
      if (nearbyMeta) nearbyMeta.textContent = 'Driver locations are unavailable right now';
    }
  }

  return () => {
    cleanups.forEach((fn) => fn());
    map?.destroy();
  };
}

function renderActiveRide(ride, user) {
  const cls = vehicleClass(ride.vehicle_class);
  const isDriverView = user.role === 'driver';
  const driver = ride.driver;
  return `
    <div class="live-head">
      <div>
        <p class="eyebrow">${icon('navigation', 13)} ${ride.status === 'requested' ? 'Request in progress' : 'Live ride'}</p>
        <h2>${ride.status === 'requested' ? 'Finding a driver near you…' : ride.status === 'accepted' ? 'Your driver is on the way' : ride.status === 'arriving' ? 'Your driver is arriving' : ride.status === 'in_progress' ? 'On the way to your destination' : 'Ride in progress'}</h2>
        <p class="live-sub">${esc(ride.pickup)} → ${esc(ride.dropoff)}</p>
      </div>
      ${statusBadge(ride.status)}
    </div>
    ${rideTimeline(ride.status)}
    <div class="live-meta">
      <span class="ride-class tone-${cls.tone}">${icon(cls.short === 'E2' ? 'zap' : 'car', 15)} ${esc(cls.name)}</span>
      <span>${icon('route', 14)} ${esc(km(ride.distance_km))} · ${esc(minutes(ride.duration_min))}</span>
      <span>${icon('wallet', 14)} ${esc(money(ride.fare))}</span>
      ${ride.scheduled_for ? `<span>${icon('calendar', 14)} ${esc(dateTime(ride.scheduled_for))}</span>` : ''}
    </div>
    ${driver ? driverCard(driver, { phone: ride.driver_phone }) : `
      <div class="matching-row">
        <span class="pulse-ring" aria-hidden="true"></span>
        <p>We are alerting approved drivers within 25 km. Most riders match in under 3 minutes.</p>
      </div>
    `}
    <div class="live-actions">
      <a class="btn btn-primary" href="#/ride/${ride.id}">${icon('map-pin', 16)} Track this ride</a>
      <a class="btn btn-ghost" href="#/ride/${ride.id}">${icon('message', 16)} Message</a>
    </div>
  `;
}
