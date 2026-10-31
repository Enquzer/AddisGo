import { api, qrUrl } from '../api.js';
import { state, refreshMe } from '../store.js';
import { icon } from '../ui/icons.js';
import {
  esc, money, km, minutes, dateTime, time, relative, avatar, stars, statusBadge,
  vehicleClass, defaultSchedule, toLocalInput,
} from '../ui/format.js';
import { pageHead, sectionHead, emptyState, errorBlock } from '../ui/layout.js';
import { rideTimeline, driverCard, openRating, routeLine } from '../ui/booking.js';
import { RideMap, locateUser, fetchStreetRoute, generateStreetGridPoints } from '../ui/map.js';
import { openModal, confirmModal, promptModal } from '../ui/modal.js';
import { mountChat } from '../ui/chat.js';
import { createPoller } from '../ui/poll.js';
import { toast, toastError } from '../ui/toast.js';
import { $, withBusy, scrollToTop } from '../ui/dom.js';
import {
  PLACES, RIDE_CLASSES, POPULAR_ROUTES, ADDIS_CENTER, placeByName, classByKey,
  searchPlaces, haversineDistanceKm,
} from '../places.js';

export const ridePrefill = { pickup: null, dropoff: null };

export default async function renderRide(view, ctx) {
  if (ctx.params.id) {
    return renderRideDetail(view, ctx);
  }
  if (state.user?.role === 'admin') {
    view.innerHTML = `<div class="panel narrow-panel">${emptyState({
      icon: 'grid',
      title: 'Admins manage rides from the CRM',
      text: 'Open the operations dashboard to inspect live rides, drivers and reports.',
      action: '<a class="btn btn-primary" href="#/admin?tab=bookings">Open rides desk</a>',
    })}</div>`;
    return () => {};
  }
  return renderBooking(view, ctx);
}

/* ------------------------------------------------------------------ */
/* Booking flow                                                        */
/* ------------------------------------------------------------------ */

async function renderBooking(view, ctx) {
  const start = ridePrefill.pickup || placeByName('Bole Medhanialem');
  const end = ridePrefill.dropoff || null;
  ridePrefill.pickup = null;
  ridePrefill.dropoff = null;

  const store = {
    pickup: start ? { lat: start.lat, lng: start.lng, label: start.name, id: start.id } : null,
    dropoff: end ? { lat: end.lat, lng: end.lng, label: end.name, id: end.id } : null,
    selected: 'e2',
    estimates: {},
    schedule: 'now',
    pickMode: null,
    busy: false,
  };

  view.innerHTML = `
    <section class="ride-booking">
      ${pageHead({
        eyebrow: 'On-demand & scheduled',
        title: 'Book a ride across Addis.',
        description: 'Upfront ETB fares, verified drivers and a live map. Pick your points, choose your class, and go.',
        actions: `<a class="btn btn-ghost" href="#/trips">${icon('route', 16)} My trips</a>`,
      })}

      <div class="booking-grid">
        <section class="panel booking-panel">
          <form class="form" id="booking-form" novalidate>
            <div class="form-alert" id="booking-error" role="alert" hidden></div>

            <div class="booking-route-block">
              <div class="route-field">
                <span class="route-node is-start" aria-hidden="true"></span>
                <div class="autocomplete-wrap">
                  <label class="field">
                    <span class="field-label">Pickup</span>
                    <input class="field-input" id="pickup-input" name="pickup" value="${esc(store.pickup?.label || '')}" placeholder="Search a landmark or area" autocomplete="off" required />
                  </label>
                  <div class="gmaps-autocomplete-dropdown" id="pickup-autocomplete" hidden></div>
                </div>
                <button type="button" class="icon-btn map-pick-btn" data-pick="pickup" title="Choose pickup on map" aria-label="Choose pickup on map">${icon('map-pin', 18)}</button>
              </div>
              <div class="route-field">
                <span class="route-node is-end" aria-hidden="true"></span>
                <div class="autocomplete-wrap">
                  <label class="field">
                    <span class="field-label">Destination</span>
                    <input class="field-input" id="dropoff-input" name="dropoff" value="${esc(store.dropoff?.label || '')}" placeholder="Where are you going?" autocomplete="off" required />
                  </label>
                  <div class="gmaps-autocomplete-dropdown" id="dropoff-autocomplete" hidden></div>
                </div>
                <button type="button" class="icon-btn map-pick-btn" data-pick="dropoff" title="Choose destination on map" aria-label="Choose destination on map">${icon('map-pin', 18)}</button>
              </div>
              <p class="field-hint route-hint" id="route-hint">${icon('info', 13)} Tap a pin button to drop your points directly on the map.</p>
              <button type="button" class="text-btn locate-link" id="use-location">${icon('navigation', 14)} Use my current location as pickup</button>
            </div>

            <div class="popular-routes">
              <span class="popular-label">Popular</span>
              ${POPULAR_ROUTES.map((r, i) => `<button type="button" class="route-chip" data-route="${i}">${esc(r.note)} <span>${esc(r.from.split('·')[0].trim())} → ${esc(r.to.split('·')[0].trim())}</span></button>`).join('')}
            </div>

            <div class="section-divider"><span>Choose your ride</span></div>
            <div id="class-options" class="class-options">
              ${classesPlaceholder(store.selected)}
            </div>
            <p class="estimate-note" id="estimate-note">${icon('wallet', 14)} Pick both points to see live fares. Prices include the estimated traffic time.</p>

            <div class="section-divider"><span>When do you need it?</span></div>
            <div class="schedule-toggle" role="radiogroup" aria-label="Ride timing">
              <label class="seg-option ${store.schedule === 'now' ? 'is-selected' : ''}">
                <input type="radio" name="schedule" value="now" checked />
                ${icon('zap', 16)} <span><strong>Leave now</strong><small>Match in a few minutes</small></span>
              </label>
              <label class="seg-option">
                <input type="radio" name="schedule" value="later" />
                ${icon('calendar', 16)} <span><strong>Schedule</strong><small>Up to 7 days ahead</small></span>
              </label>
            </div>
            <div class="schedule-fields" id="schedule-fields" hidden>
              <label class="field">
                <span class="field-label">Pickup date &amp; time</span>
                <input class="field-input" type="datetime-local" name="scheduled_for" id="scheduled-for" value="${defaultSchedule(3)}" min="${toLocalInput(Date.now() + 35 * 60000)}" max="${toLocalInput(Date.now() + 7 * 86400000)}" />
                <span class="field-hint">Local Addis time. We start matching 20 minutes before pickup.</span>
              </label>
            </div>

            <label class="field">
              <span class="field-label">Note for your driver <em>(optional)</em></span>
              <textarea class="field-input" name="notes" rows="2" maxlength="300" placeholder="Gate code, luggage, or where to meet you"></textarea>
            </label>

            <div class="booking-submit">
              <div class="fare-summary" id="fare-summary">
                <span>Estimated fare</span>
                <strong>—</strong>
              </div>
              <button type="submit" class="btn btn-primary btn-lg" id="book-btn" disabled>
                ${icon('car', 18)} Request ride
              </button>
            </div>
            <p class="fine-print">${icon('shield', 13)} Your exact pickup is shared only with matched drivers. Cancel free before the trip starts.</p>
          </form>
        </section>

        <aside class="booking-side">
          <section class="panel map-panel booking-map-panel">
            <div class="panel-head-row">
              <div><h2>Your route</h2><p id="map-hint">Tap the map or the pin buttons to adjust your trip.</p></div>
              <span class="badge badge-soft" id="map-mode-badge" hidden></span>
            </div>
            <div id="booking-map" class="booking-map" aria-label="Map for choosing pickup and destination"></div>
            <div class="booking-map-foot">
              <div id="booking-route-summary" class="booking-route-summary">
                <span class="muted">No route selected yet.</span>
              </div>
              <button type="button" class="btn btn-xs btn-ghost" id="reset-route">${icon('refresh', 13)} Reset</button>
            </div>
          </section>

          <section class="panel tip-panel">
            <span class="tip-icon">${icon('leaf', 20)}</span>
            <div>
              <strong>Why E2 first?</strong>
              <p>Electric E2 cars are quieter, cheaper per kilometre and produce no tailpipe emissions in a city where air quality matters.</p>
            </div>
          </section>

          <section class="panel driver-standards">
            <h2>Every driver, reviewed</h2>
            <ul class="check-list">
              <li>${icon('check-circle', 15)} Licence and vehicle documents checked</li>
              <li>${icon('check-circle', 15)} Ratings visible before you book</li>
              <li>${icon('check-circle', 15)} Trip code matches your QR pass</li>
              <li>${icon('check-circle', 15)} 24/7 safety desk for reports</li>
            </ul>
          </section>
        </aside>
      </div>
    </section>
  `;

  const form = $('#booking-form', view);
  const errorBox = $('#booking-error', view);
  const pickupInput = $('#pickup-input', view);
  const dropoffInput = $('#dropoff-input', view);
  const pickupDropdown = $('#pickup-autocomplete', view);
  const dropoffDropdown = $('#dropoff-autocomplete', view);
  const classBox = $('#class-options', view);
  const summary = $('#fare-summary', view);
  const estimateNote = $('#estimate-note', view);
  const bookBtn = $('#book-btn', view);
  const mapEl = $('#booking-map', view);
  const routeSummary = $('#booking-route-summary', view);
  const mapHint = $('#map-hint', view);
  const modeBadge = $('#map-mode-badge', view);
  let userGeoLocation = null;
  let map = null;
  let estimateToken = 0;
  const cleanups = [];

  const showError = (message) => {
    errorBox.hidden = false;
    errorBox.innerHTML = `${icon('info', 16)}<span>${esc(message)}</span>`;
  };
  const clearError = () => {
    errorBox.hidden = true;
    errorBox.innerHTML = '';
  };

  if (mapEl) {
    map = new RideMap(mapEl, { center: start || ADDIS_CENTER, zoom: start ? 13 : 12 });
    map.setPickup(store.pickup);
    if (store.dropoff) map.setDropoff(store.dropoff);
    if (store.pickup && store.dropoff) {
      drawRoute(map, store.pickup, store.dropoff);
      map.fitPoints([[store.pickup.lat, store.pickup.lng], [store.dropoff.lat, store.dropoff.lng]]);
    }
  }

  const syncInputs = () => {
    if (store.pickup) pickupInput.value = store.pickup.label;
    if (store.dropoff) dropoffInput.value = store.dropoff.label;
    map?.setPickup(store.pickup);
    if (store.dropoff) map?.setDropoff(store.dropoff);
    renderRouteSummary();
  };

  const renderRouteSummary = () => {
    if (!routeSummary) return;
    if (!store.pickup && !store.dropoff) {
      routeSummary.innerHTML = `<span class="muted">No route selected yet.</span>`;
      return;
    }
    if (!store.dropoff) {
      routeSummary.innerHTML = `<span class="route-summary-line"><span class="dot start"></span>${esc(store.pickup?.label || 'Pickup')} <em>→ add a destination</em></span>`;
      return;
    }
    const est = store.estimates[store.selected];
    routeSummary.innerHTML = `<span class="route-summary-line"><span class="dot start"></span>${esc(store.pickup.label)} <span class="arrow">→</span> <span class="dot end"></span>${esc(store.dropoff.label)}</span>
      ${est ? `<span class="route-summary-meta">${esc(km(est.distance_km))} · ${esc(minutes(est.duration_min))} · <strong>${esc(money(est.fare))}</strong></span>` : ''}`;
  };

  const setPickMode = (mode) => {
    store.pickMode = store.pickMode === mode ? null : mode;
    map?.onPick(store.pickMode, (point) => {
      applyPoint(store.pickMode, point);
      setPickMode(null);
    });
    view.querySelectorAll('[data-pick]').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.pick === store.pickMode);
    });
    if (modeBadge) {
      modeBadge.hidden = !store.pickMode;
      modeBadge.textContent = store.pickMode === 'pickup' ? 'Tap map to set pickup' : 'Tap map to set destination';
    }
    if (mapHint) {
      mapHint.textContent = store.pickMode
        ? `Tap the map to place your ${store.pickMode}.`
        : 'Tap the map or the pin buttons to adjust your trip.';
    }
  };

  const applyPoint = (which, point) => {
    const label = nearestLabel(point.lat, point.lng);
    const place = { lat: point.lat, lng: point.lng, label };
    if (which === 'pickup') {
      store.pickup = place;
      pickupInput.value = label;
    } else {
      store.dropoff = place;
      dropoffInput.value = label;
    }
    clearError();
    map?.setPickup(store.pickup);
    if (store.dropoff) map?.setDropoff(store.dropoff);
    if (store.pickup && store.dropoff) {
      drawRoute(map, store.pickup, store.dropoff);
      map?.fitPoints([[store.pickup.lat, store.pickup.lng], [store.dropoff.lat, store.dropoff.lng]]);
      void loadEstimates();
    } else {
      map?.panTo(point.lat, point.lng, 14);
    }
    renderRouteSummary();
  };

  view.querySelectorAll('[data-pick]').forEach((btn) => {
    btn.addEventListener('click', () => setPickMode(btn.dataset.pick));
  });

  function highlightQuery(text, query) {
    if (!query || !text) return esc(text || '');
    const cleanQ = query.trim();
    if (!cleanQ) return esc(text);
    const escapedQ = cleanQ.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(${escapedQ})`, 'gi');
    const parts = String(text).split(regex);
    return parts.map((part) => (part.toLowerCase() === cleanQ.toLowerCase() ? `<mark>${esc(part)}</mark>` : esc(part))).join('');
  }

  function formatDist(distKm) {
    if (distKm === null || distKm === undefined || isNaN(distKm)) return '';
    if (distKm < 1) return `${Math.round(distKm * 1000)} m`;
    return `${distKm.toFixed(1)} km`;
  }

  function setupAutocomplete(which, inputEl, dropdownEl) {
    if (!inputEl || !dropdownEl) return { close: () => {} };
    let activeIndex = -1;
    let currentResults = [];

    const getOrigin = () => {
      if (which === 'dropoff') {
        return store.pickup ? { lat: store.pickup.lat, lng: store.pickup.lng } : (userGeoLocation || ADDIS_CENTER);
      }
      return userGeoLocation || (store.dropoff ? { lat: store.dropoff.lat, lng: store.dropoff.lng } : ADDIS_CENTER);
    };

    const renderDropdown = (results, query) => {
      currentResults = results;
      activeIndex = -1;
      if (!results.length) {
        dropdownEl.innerHTML = `
          <div class="gmaps-suggest-empty">
            ${icon('search', 15)}
            <span>No matching landmarks found for "${esc(query)}". Use the pin button to drop on map.</span>
          </div>
        `;
        dropdownEl.hidden = false;
        return;
      }

      dropdownEl.innerHTML = results.map((place, idx) => {
        const distStr = formatDist(place.distanceKm);
        return `
          <div class="gmaps-suggest-item" role="option" data-idx="${idx}" tabindex="-1">
            <span class="gmaps-suggest-icon">${icon(place.icon || 'map-pin', 16)}</span>
            <div class="gmaps-suggest-body">
              <div class="gmaps-suggest-title">${highlightQuery(place.name, query)}</div>
              <div class="gmaps-suggest-sub">
                ${place.amharic ? `<span class="gmaps-suggest-geez">${esc(place.amharic)}</span> · ` : ''}
                ${esc(place.area || '')}${place.landmarkDetail ? ` · ${esc(place.landmarkDetail)}` : ''}
              </div>
            </div>
            ${distStr ? `<span class="gmaps-suggest-dist" title="Distance">${esc(distStr)}</span>` : ''}
          </div>
        `;
      }).join('');
      dropdownEl.hidden = false;
    };

    const closeDropdown = () => {
      dropdownEl.hidden = true;
      dropdownEl.innerHTML = '';
      activeIndex = -1;
      currentResults = [];
    };

    const selectPlace = (place) => {
      inputEl.value = place.name;
      const point = { lat: place.lat, lng: place.lng, label: place.name, id: place.id };
      if (which === 'pickup') {
        store.pickup = point;
        map?.setPickup(store.pickup);
        if (!store.dropoff) {
          dropoffInput.focus();
        }
      } else {
        store.dropoff = point;
        map?.setDropoff(store.dropoff);
      }
      clearError();
      closeDropdown();

      if (store.pickup && store.dropoff) {
        drawRoute(map, store.pickup, store.dropoff);
        map?.fitPoints([[store.pickup.lat, store.pickup.lng], [store.dropoff.lat, store.dropoff.lng]]);
        void loadEstimates();
      } else {
        map?.panTo(place.lat, place.lng, 14);
      }
      renderRouteSummary();
    };

    const updateActive = () => {
      const items = dropdownEl.querySelectorAll('.gmaps-suggest-item');
      items.forEach((el, idx) => {
        el.classList.toggle('is-active', idx === activeIndex);
        if (idx === activeIndex) {
          el.scrollIntoView({ block: 'nearest' });
        }
      });
    };

    inputEl.addEventListener('input', () => {
      const q = inputEl.value.trim();
      const origin = getOrigin();
      const results = searchPlaces(q, origin);
      renderDropdown(results, q);

      const matched = placeByName(inputEl.value);
      if (matched) {
        if (which === 'pickup') {
          store.pickup = { lat: matched.lat, lng: matched.lng, label: matched.name, id: matched.id };
          map?.setPickup(store.pickup);
        } else {
          store.dropoff = { lat: matched.lat, lng: matched.lng, label: matched.name, id: matched.id };
          if (store.dropoff) map?.setDropoff(store.dropoff);
        }
        scheduleEstimateUpdate();
        renderRouteSummary();
      } else {
        if (which === 'pickup') store.pickup = null;
        else store.dropoff = null;
        bookBtn.disabled = true;
        renderRouteSummary();
      }
    });

    inputEl.addEventListener('focus', () => {
      const q = inputEl.value.trim();
      const origin = getOrigin();
      const results = searchPlaces(q, origin);
      renderDropdown(results, q);
    });

    inputEl.addEventListener('blur', () => {
      window.setTimeout(() => {
        closeDropdown();
        const current = which === 'pickup' ? store.pickup : store.dropoff;
        if (!current && inputEl.value.trim()) {
          showError(`Pick a suggested ${which === 'pickup' ? 'pickup point' : 'destination'} or drop a pin on the map.`);
        }
      }, 200);
    });

    inputEl.addEventListener('keydown', (e) => {
      if (dropdownEl.hidden) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          const q = inputEl.value.trim();
          renderDropdown(searchPlaces(q, getOrigin()), q);
        }
        return;
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (currentResults.length > 0) {
          activeIndex = (activeIndex + 1) % currentResults.length;
          updateActive();
        }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (currentResults.length > 0) {
          activeIndex = (activeIndex - 1 + currentResults.length) % currentResults.length;
          updateActive();
        }
      } else if (e.key === 'Enter') {
        if (activeIndex >= 0 && activeIndex < currentResults.length) {
          e.preventDefault();
          selectPlace(currentResults[activeIndex]);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        closeDropdown();
      }
    });

    dropdownEl.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const item = e.target.closest('.gmaps-suggest-item');
      if (!item) return;
      const idx = Number(item.dataset.idx);
      if (currentResults[idx]) {
        selectPlace(currentResults[idx]);
      }
    });

    return { close: closeDropdown };
  }

  const pickupAuto = setupAutocomplete('pickup', pickupInput, pickupDropdown);
  const dropoffAuto = setupAutocomplete('dropoff', dropoffInput, dropoffDropdown);

  const onDocClick = (e) => {
    if (!e.target.closest('.autocomplete-wrap')) {
      pickupAuto.close();
      dropoffAuto.close();
    }
  };
  document.addEventListener('click', onDocClick);
  cleanups.push(() => document.removeEventListener('click', onDocClick));

  view.querySelectorAll('[data-route]').forEach((chip) => {
    chip.addEventListener('click', () => {
      const route = POPULAR_ROUTES[Number(chip.dataset.route)];
      const from = placeByName(route.from);
      const to = placeByName(route.to);
      if (!from || !to) return;
      store.pickup = { lat: from.lat, lng: from.lng, label: from.name, id: from.id };
      store.dropoff = { lat: to.lat, lng: to.lng, label: to.name, id: to.id };
      pickupAuto.close();
      dropoffAuto.close();
      syncInputs();
      drawRoute(map, store.pickup, store.dropoff);
      map?.fitPoints([[from.lat, from.lng], [to.lat, to.lng]]);
      void loadEstimates();
    });
  });

  $('#reset-route', view)?.addEventListener('click', () => {
    store.pickup = null;
    store.dropoff = null;
    store.estimates = {};
    pickupInput.value = '';
    dropoffInput.value = '';
    pickupAuto.close();
    dropoffAuto.close();
    map?.destroy();
    if (mapEl) {
      map = new RideMap(mapEl, { center: ADDIS_CENTER, zoom: 12 });
    }
    renderClasses();
    renderRouteSummary();
    bookBtn.disabled = true;
    summary.querySelector('strong').textContent = '—';
    clearError();
  });

  $('#use-location', view)?.addEventListener('click', async (event) => {
    const btn = event.currentTarget;
    try {
      await withBusy(btn, async () => {
        const pos = await locateUser();
        userGeoLocation = pos;
        applyPoint('pickup', pos);
        pickupInput.value = nearestLabel(pos.lat, pos.lng);
        toast('Pickup set to your current location.', { type: 'info' });
      });
    } catch (error) {
      showError(error.message);
    }
  });

  const scheduleEstimateUpdate = debounce(() => void loadEstimates(), 320);

  async function loadEstimates() {
    if (!store.pickup || !store.dropoff) {
      store.estimates = {};
      renderClasses();
      renderRouteSummary();
      bookBtn.disabled = true;
      summary.querySelector('strong').textContent = '—';
      return;
    }
    const token = ++estimateToken;
    bookBtn.disabled = true;
    estimateNote.innerHTML = `<span class="spinner spinner-xs"></span> Pricing your trip…`;
    const results = await Promise.allSettled(
      RIDE_CLASSES.map((cls) => api('/estimate', {
        method: 'POST',
        body: {
          pickup_lat: store.pickup.lat,
          pickup_lng: store.pickup.lng,
          dropoff_lat: store.dropoff.lat,
          dropoff_lng: store.dropoff.lng,
          vehicle_class: cls.key,
        },
      })),
    );
    if (token !== estimateToken) return;
    const next = {};
    let error = null;
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') next[RIDE_CLASSES[index].key] = result.value;
      else error = result.reason;
    });
    store.estimates = next;
    renderClasses();
    renderRouteSummary();
    const est = next[store.selected];
    if (est) {
      bookBtn.disabled = false;
      summary.querySelector('strong').textContent = money(est.fare);
      estimateNote.innerHTML = `${icon('wallet', 14)} ${esc(km(est.distance_km))} · about ${esc(minutes(est.duration_min))}. Fare is confirmed at booking.`;
    } else {
      bookBtn.disabled = true;
      summary.querySelector('strong').textContent = '—';
      estimateNote.innerHTML = `${icon('info', 14)} ${esc(error?.message || 'We could not price this route. Try another destination.')}`;
    }
  }

  function renderClasses() {
    classBox.innerHTML = classPickerMarkup(store.selected, store.estimates);
    classBox.querySelectorAll('input[name="ride-class"]').forEach((input) => {
      input.addEventListener('change', () => {
        store.selected = input.value;
        classBox.querySelectorAll('.class-option').forEach((el) => {
          el.classList.toggle('is-selected', el.querySelector('input')?.value === store.selected);
        });
        const est = store.estimates[store.selected];
        bookBtn.disabled = !est;
        summary.querySelector('strong').textContent = est ? money(est.fare) : '—';
        renderRouteSummary();
      });
    });
  }
  renderClasses();

  // Timing toggle
  form.querySelectorAll('input[name="schedule"]').forEach((input) => {
    input.addEventListener('change', () => {
      store.schedule = input.value;
      form.querySelectorAll('.seg-option').forEach((el) => {
        el.classList.toggle('is-selected', el.querySelector('input')?.checked);
      });
      $('#schedule-fields', view).hidden = store.schedule !== 'later';
    });
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearError();
    if (!store.pickup) {
      showError('Choose a pickup point from the list or the map.');
      pickupInput.focus();
      return;
    }
    if (!store.dropoff) {
      showError('Choose a destination from the list or the map.');
      dropoffInput.focus();
      return;
    }
    const est = store.estimates[store.selected];
    if (!est) {
      showError('We could not price this ride. Adjust your points and try again.');
      return;
    }
    const notes = form.querySelector('[name="notes"]').value.trim();
    let scheduledFor = null;
    if (store.schedule === 'later') {
      const value = $('#scheduled-for', view).value;
      if (!value) {
        showError('Choose a pickup time.');
        return;
      }
      const dateObj = new Date(value);
      if (dateObj.getTime() < Date.now() + 25 * 60000) {
        showError('Schedule at least 30 minutes ahead.');
        return;
      }
      scheduledFor = dateObj.toISOString();
    }

    await withBusy(bookBtn, async () => {
      try {
        const booking = await api('/bookings', {
          method: 'POST',
          body: {
            pickup: store.pickup.label,
            pickup_lat: store.pickup.lat,
            pickup_lng: store.pickup.lng,
            dropoff: store.dropoff.label,
            dropoff_lat: store.dropoff.lat,
            dropoff_lng: store.dropoff.lng,
            vehicle_class: store.selected,
            scheduled_for: scheduledFor,
            notes,
          },
        });
        toast(scheduledFor ? 'Ride scheduled. We will match you before pickup.' : 'Request sent — finding a driver near you.');
        window.dispatchEvent(new CustomEvent('notifications:refresh'));
        ctx.navigate(`/ride/${booking.id}`);
      } catch (error) {
        showError(error.message || 'Could not create your ride.');
        toastError(error);
      }
    });
  });

  renderRouteSummary();

  return () => {
    cleanups.forEach((fn) => fn());
    map?.destroy();
  };
}

function classesPlaceholder(selected) {
  return classPickerMarkup(selected, {});
}

function classPickerMarkup(selected, estimates) {
  return `<div class="class-grid" role="radiogroup" aria-label="Ride class">
    ${RIDE_CLASSES.map((cls) => {
      const est = estimates[cls.key];
      return `<label class="class-option ${cls.key === selected ? 'is-selected' : ''}">
        <input type="radio" name="ride-class" value="${cls.key}" ${cls.key === selected ? 'checked' : ''} />
        <span class="class-option-icon tone-${cls.key === 'e2' ? 'green' : cls.key === 'comfort' ? 'blue' : cls.key === 'van' ? 'amber' : 'red'}">${icon(cls.key === 'e2' ? 'zap' : cls.key === 'van' ? 'users' : cls.key === 'bajaj' ? 'navigation' : 'car', 20)}</span>
        <span class="class-option-copy">
          <strong>${esc(cls.name)} ${cls.badge ? `<em class="class-badge">${esc(cls.badge)}</em>` : ''}</strong>
          <small>${esc(cls.tagline)}</small>
          <em>${esc(cls.seats)} seats</em>
        </span>
        <span class="class-option-fare">${est ? money(est.fare) : '<span class="fare-dash">—</span>'}<small>${est ? minutes(est.duration_min) : 'Set route'}</small></span>
      </label>`;
    }).join('')}
  </div>`;
}

async function drawRoute(map, from, to) {
  if (!map?.ready || !from || !to) return;
  try {
    const routeData = await fetchStreetRoute(from.lat, from.lng, to.lat, to.lng);
    if (routeData?.points?.length) {
      map.setRoute(routeData.points, { color: '#0d3b2e', haloColor: '#f4b860', weight: 5, dashed: false });
      return;
    }
  } catch {
    /* fallback to street grid */
  }
  map.setRoute(curvePoints(from, to), { color: '#0d3b2e', haloColor: '#f4b860', weight: 5, dashed: false });
}

function curvePoints(from, to) {
  return generateStreetGridPoints(from.lat, from.lng, to.lat, to.lng);
}

function nearestLabel(lat, lng) {
  let best = null;
  let bestDist = Infinity;
  for (const place of PLACES) {
    const d = haversine(lat, lng, place.lat, place.lng);
    if (d < bestDist) {
      bestDist = d;
      best = place;
    }
  }
  if (best && bestDist < 1.1) return `Near ${best.name}`;
  return `Pinned location · ${lat.toFixed(3)}, ${lng.toFixed(3)}`;
}

function haversine(aLat, aLng, bLat, bLng) {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function debounce(fn, wait) {
  let timer = null;
  return (...args) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), wait);
  };
}

/* ------------------------------------------------------------------ */
/* Ride detail / live tracking                                         */
/* ------------------------------------------------------------------ */

async function renderRideDetail(view, ctx) {
  const id = Number(ctx.params.id);
  if (!Number.isFinite(id)) {
    ctx.navigate('/trips', { replace: true });
    return () => {};
  }

  let booking;
  try {
    booking = await api(`/bookings/${id}`);
  } catch (error) {
    view.innerHTML = `<div class="panel narrow-panel">
      ${errorBlock(error.status === 404 ? 'That ride is not available on this account.' : error.message, { id: 'ride-retry' })}
      <a class="btn btn-ghost" href="#/trips">${icon('arrow-left', 15)} Back to trips</a>
    </div>`;
    $('#ride-retry', view)?.addEventListener('click', () => void ctx.navigate(`/ride/${id}`));
    return () => {};
  }

  const me = state.user;
  const isDriver = booking.driver?.user_id === me.id;
  const isCustomer = booking.customer?.id === me.id;
  const isAdmin = me.role === 'admin';
  const role = isDriver ? 'driver' : isCustomer ? 'customer' : 'admin';

  view.innerHTML = `
    <section class="ride-detail">
      <div class="ride-detail-top">
        <a class="back-link" href="#/trips">${icon('arrow-left', 16)} Trips</a>
        <div class="ride-code">
          <span>Pass code</span>
          <strong>${esc(booking.code)}</strong>
        </div>
        <span id="ride-status-pill">${statusBadge(booking.status)}</span>
      </div>

      <div class="ride-detail-grid">
        <section class="panel map-panel ride-map-panel">
          <div id="ride-map" class="ride-map" aria-label="Live ride map"></div>
          <div class="ride-map-overlay">
            <span class="ride-class tone-${vehicleClass(booking.vehicle_class).tone}">${icon(booking.vehicle_class === 'e2' ? 'zap' : 'car', 15)} ${esc(vehicleClass(booking.vehicle_class).name)}</span>
            <span class="map-overlay-fare">${esc(money(booking.fare))}</span>
          </div>
          <div class="ride-map-foot">
            ${routeLine(booking.pickup, booking.dropoff, { compact: true })}
          </div>
        </section>

        <aside class="ride-detail-side">
          <section class="panel" id="ride-live"></section>
          <section class="panel" id="ride-pass-panel"></section>
          <section class="panel" id="ride-chat-panel"></section>
          <section class="panel" id="ride-support-panel"></section>
        </aside>
      </div>
    </section>
  `;

  const map = new RideMap($('#ride-map', view), {
    center: { lat: booking.pickup_lat, lng: booking.pickup_lng },
    zoom: 13,
  });
  if (map.ready) {
    map.setPickup({ lat: booking.pickup_lat, lng: booking.pickup_lng, label: 'Pickup' });
    map.setDropoff({ lat: booking.dropoff_lat, lng: booking.dropoff_lng, label: 'Destination' });
    drawRoute(
      map,
      { lat: booking.pickup_lat, lng: booking.pickup_lng },
      { lat: booking.dropoff_lat, lng: booking.dropoff_lng },
    );
    map.fitPoints([[booking.pickup_lat, booking.pickup_lng], [booking.dropoff_lat, booking.dropoff_lng]]);
    if (booking.driver?.lat && booking.driver?.lng) {
      map.setCar(booking.driver.lat, booking.driver.lng);
      map.fitAll();
    }
  }

  const liveEl = $('#ride-live', view);
  const passEl = $('#ride-pass-panel', view);
  const chatEl = $('#ride-chat-panel', view);
  const supportEl = $('#ride-support-panel', view);
  let chat = null;
  let chatEnabled = null;
  let renderedStatus = null;
  let poller = null;

  const renderLive = (b) => {
    const status = b.status;
    const driver = b.driver;
    const pillHost = $('#ride-status-pill', view);
    if (pillHost) pillHost.outerHTML = statusBadge(status).replace('class="badge', 'id="ride-status-pill" class="badge');

    const headline = {
      requested: b.scheduled_for ? 'Scheduled — finding your driver' : 'Finding a driver near you…',
      accepted: 'Your driver is on the way',
      arriving: 'Your driver is arriving',
      in_progress: 'On the way to your destination',
      completed: 'Trip completed',
      cancelled: 'This ride was cancelled',
    }[status] || 'Ride in progress';

    const canCancel = (role === 'customer' && ['requested', 'accepted', 'arriving'].includes(status))
      || (role === 'driver' && ['accepted', 'arriving'].includes(status))
      || (role === 'admin' && !['completed', 'cancelled'].includes(status));

    const actionButtons = [];
    if (role === 'driver') {
      if (status === 'accepted') {
        actionButtons.push(`<button class="btn btn-primary" data-act="arriving">${icon('navigation', 16)} I'm arriving</button>`);
        actionButtons.push(`<button class="btn btn-ghost" data-act="in_progress">${icon('car', 16)} Start trip</button>`);
      }
      if (status === 'arriving') {
        actionButtons.push(`<button class="btn btn-primary" data-act="in_progress">${icon('car', 16)} Start trip</button>`);
      }
      if (status === 'in_progress') {
        actionButtons.push(`<button class="btn btn-primary" data-act="complete">${icon('check', 16)} Complete trip</button>`);
      }
    }
    if (role === 'customer' || isAdmin) {
      if (['accepted', 'arriving'].includes(status)) {
        actionButtons.push(`<button class="btn btn-ghost" data-act="show-qr">${icon('qr', 16)} Check-in pass</button>`);
      }
      if (status === 'completed' && !b.rating) {
        actionButtons.push(`<button class="btn btn-primary" data-act="rate">${icon('star', 16)} Rate your trip</button>`);
      }
      if (['completed', 'cancelled'].includes(status)) {
        actionButtons.push(`<button class="btn btn-ghost" data-act="rebook">${icon('refresh', 16)} Book again</button>`);
      }
    }
    if (canCancel) {
      actionButtons.push(`<button class="btn btn-ghost btn-danger-text" data-act="cancel">${icon('ban', 16)} Cancel ride</button>`);
    }

    liveEl.innerHTML = `
      <div class="live-head">
        <div>
          <p class="eyebrow">${icon('navigation', 13)} ${status === 'requested' ? 'Matching' : status === 'completed' ? 'Receipt' : 'Live trip'}</p>
          <h1 class="ride-headline">${esc(headline)}</h1>
          <p class="live-sub">${esc(b.pickup)} → ${esc(b.dropoff)}</p>
        </div>
      </div>
      ${rideTimeline(status)}
      <div class="live-meta">
        <span>${icon('route', 14)} ${esc(km(b.distance_km))} · ${esc(minutes(b.duration_min))}</span>
        <span>${icon('wallet', 14)} ${esc(money(b.fare))}</span>
        <span>${icon('calendar', 14)} ${b.scheduled_for ? esc(dateTime(b.scheduled_for)) : esc(dateTime(b.created_at))}</span>
      </div>

      ${status === 'requested' ? `
        <div class="matching-row">
          <span class="pulse-ring" aria-hidden="true"></span>
          <div>
            <strong>Alerting drivers nearby</strong>
            <p>${b.scheduled_for ? `We will match a driver before ${esc(time(b.scheduled_for))}.` : 'This usually takes under 3 minutes. Keep this page open.'}</p>
          </div>
        </div>
      ` : ''}

      ${driver && status !== 'requested' ? `
        <div class="driver-block">
          ${driverCard(driver, { phone: b.driver_phone, distance: driver.lat && b.status !== 'completed' ? haversine(b.pickup_lat, b.pickup_lng, driver.lat, driver.lng) : null })}
          <div class="driver-vehicle">
            <span>${esc(driver.color || '')} ${esc(driver.make_model)}</span>
            <span class="plate">${esc(driver.plate)}</span>
          </div>
        </div>
      ` : ''}

      ${role !== 'customer' && status !== 'requested' ? `
        <div class="customer-block">
          ${avatar(b.customer, 40)}
          <div>
            <strong>${esc(b.customer.name)}</strong>
            <small>${esc(b.customer_phone || 'Phone shared once accepted')}</small>
          </div>
          ${b.customer_phone ? `<a class="btn btn-xs btn-ghost" href="tel:${esc(b.customer_phone)}">${icon('phone', 13)} Call</a>` : ''}
        </div>
      ` : ''}

      ${b.rating ? `<div class="rating-receipt">${icon('star', 15)} You rated this trip ${b.rating}/5 ${b.review ? `<em>“${esc(b.review)}”</em>` : ''}</div>` : ''}

      <div class="live-actions">${actionButtons.join('')}</div>

      ${status === 'in_progress' && role === 'driver' ? `
        <form class="verify-inline" id="verify-form">
          <label class="field">
            <span class="field-label">Confirm rider pass code</span>
            <span class="inline-form">
              <input class="field-input" name="code" placeholder="${esc(b.code)}" maxlength="20" autocomplete="off" />
              <button class="btn btn-ghost" type="submit">${icon('qr', 15)} Verify</button>
            </span>
          </label>
        </form>
      ` : ''}
    `;
  };

  const renderPass = (b) => {
    const eligible = ['accepted', 'arriving', 'in_progress'].includes(b.status);
    passEl.innerHTML = `
      <div class="panel-head-row">
        <div><h2>Check-in pass</h2><p>Show this to your driver or scan it at pickup.</p></div>
        ${icon('qr', 22)}
      </div>
      ${eligible ? `
        <div class="pass-card">
          <div class="pass-code"><span>Code</span><strong>${esc(b.code)}</strong></div>
          <button type="button" class="qr-preview" data-act="show-qr" aria-label="Show QR check-in pass">
            <img src="${qrUrl(b.id)}" alt="QR code for ride ${esc(b.code)}" loading="lazy" />
          </button>
          <p class="pass-hint">${icon('shield', 13)} The QR contains only your trip code. Drivers verify it in the app.</p>
        </div>
      ` : b.status === 'completed' ? `
        <div class="pass-done">${icon('check-circle', 22)} <p>Trip complete. Pass ${esc(b.code)} is now closed.</p></div>
      ` : b.status === 'cancelled' ? `
        <div class="pass-done">${icon('ban', 20)} <p>This ride was cancelled.</p></div>
      ` : `
        <p class="muted pass-wait">${icon('clock', 15)} Your QR pass appears as soon as a driver accepts.</p>
        <div class="pass-code is-muted"><span>Request code</span><strong>${esc(b.code)}</strong></div>
      `}
    `;
  };

  const renderChat = (b) => {
    const enabled = ['accepted', 'arriving', 'in_progress', 'completed'].includes(b.status);
    if (chat && chatEnabled === enabled) {
      return;
    }
    chat?.stop();
    chat = null;
    chatEnabled = enabled;
    chatEl.innerHTML = `
      <div class="panel-head-row">
        <div><h2>Trip chat</h2><p>${role === 'customer' ? 'Message your driver without sharing your number.' : 'Message your rider about the pickup.'}</p></div>
        ${icon('message', 20)}
      </div>
      <div id="ride-chat"></div>
    `;
    chat = mountChat($('#ride-chat', chatEl), {
      title: role === 'customer' ? (b.driver ? `Ride Chat · ${b.driver.name}` : 'Ride Chat') : `Rider · ${b.customer?.name || 'Customer'}`,
      participants: b.driver ? [{ name: b.driver.name, role: 'Driver', avatar_color: b.driver.avatar_color }] : [],
      load: () => api(`/bookings/${b.id}/messages`),
      send: (body) => api(`/bookings/${b.id}/messages`, { method: 'POST', body: { body } }),
      interval: 5000,
      disabled: !enabled,
      disabledText: b.status === 'requested' ? 'Chat opens when a driver accepts.' : 'Chat is closed for this trip.',
      emptyText: role === 'customer' ? 'Say hello to your driver 👋' : 'Message your rider if you need to coordinate pickup.',
      me,
    });
  };

  const renderSupport = (b) => {
    supportEl.innerHTML = `
      <div class="panel-head-row">
        <div><h2>Need help?</h2><p>Our safety desk reviews every report.</p></div>
        ${icon('shield', 20)}
      </div>
      <div class="support-actions">
        <button class="btn btn-ghost btn-sm" data-act="report">${icon('flag', 15)} Report an issue</button>
        <a class="btn btn-ghost btn-sm" href="mailto:support@addisgo.et?subject=${encodeURIComponent(`Ride ${b.code}`)}">${icon('mail', 15)} Email support</a>
      </div>
      <p class="fine-print">Include trip ${esc(b.code)} in any message so we can find your ride quickly.</p>
    `;
  };

  const showQr = (b) => {
    openModal({
      title: 'Your check-in pass',
      eyebrow: `Ride ${b.code}`,
      size: 'sm',
      body: `
        <div class="qr-modal">
          <img src="${qrUrl(b.id)}" alt="QR check-in pass" class="qr-large" />
          <p class="qr-code">${esc(b.code)}</p>
          <p class="qr-note">The QR encodes <code>ADDISGO|booking:${esc(b.code)}</code>. Drivers verify it from their dashboard.</p>
        </div>
      `,
      footer: `<a class="btn btn-ghost" href="${qrUrl(b.id)}" download="addisgo-pass-${esc(b.code)}.svg">${icon('download', 16)} Download</a><button type="button" class="btn btn-primary" data-close>Done</button>`,
    }).footer?.querySelector('[data-close]')?.addEventListener('click', (event) => {
      event.target.closest('.modal-overlay')?.querySelector('.modal-close')?.click();
    });
  };

  liveEl.addEventListener('click', async (event) => {
    const btn = event.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;

    if (act === 'show-qr') {
      showQr(booking);
      return;
    }
    if (act === 'rate') {
      openRating(booking, { onRated: (updated) => { booking = updated; renderAll(updated, true); } });
      return;
    }
    if (act === 'rebook') {
      ridePrefill.pickup = { lat: booking.pickup_lat, lng: booking.pickup_lng, label: booking.pickup };
      ridePrefill.dropoff = { lat: booking.dropoff_lat, lng: booking.dropoff_lng, label: booking.dropoff };
      ctx.navigate('/ride');
      return;
    }
    if (act === 'cancel') {
      const ok = await confirmModal({
        title: 'Cancel this ride?',
        message: role === 'driver'
          ? 'This rider will be notified and will need to request another driver.'
          : 'Your driver will be notified. You can book again right away.',
        confirmLabel: 'Yes, cancel',
        cancelLabel: 'Keep ride',
        danger: true,
      });
      if (!ok) return;
      await withBusy(btn, async () => {
        try {
          const updated = await api(`/bookings/${booking.id}/cancel`, { method: 'POST', body: { reason: 'Cancelled in app' } });
          booking = updated;
          renderAll(updated, true);
          toast('Ride cancelled.');
        } catch (error) {
          toastError(error);
        }
      });
      return;
    }
    if (['arriving', 'in_progress', 'complete'].includes(act)) {
      const nextStatus = act === 'complete' ? 'completed' : act;
      if (act === 'complete') {
        const ok = await confirmModal({
          title: 'Complete this trip?',
          message: 'Confirm that you have dropped the rider at their destination.',
          confirmLabel: 'Complete trip',
        });
        if (!ok) return;
      }
      await withBusy(btn, async () => {
        try {
          const updated = await api(`/bookings/${booking.id}/status`, { method: 'PATCH', body: { status: nextStatus } });
          booking = updated;
          renderAll(updated, true);
          if (nextStatus === 'completed') {
            toast('Trip completed. Nice work.');
            window.dispatchEvent(new CustomEvent('notifications:refresh'));
            try { await refreshMe(); } catch { /* ignore */ }
          } else {
            toast(nextStatus === 'arriving' ? 'Rider notified that you are arriving.' : 'Trip started. Safe travels.');
          }
        } catch (error) {
          toastError(error);
        }
      });
      return;
    }
    if (act === 'report') {
      const reason = await promptModal({
        title: 'Report a safety issue',
        eyebrow: `Ride ${booking.code}`,
        label: 'What went wrong?',
        placeholder: 'Unsafe driving, harassment, wrong route…',
        confirmLabel: 'Send to safety desk',
        multiline: true,
        maxLength: 200,
        hint: '3–200 characters. Our team reads every report.',
      });
      if (!reason) return;
      try {
        await api('/reports', {
          method: 'POST',
          body: { target_type: 'booking', target_id: booking.id, reason: reason.trim(), detail: `Ride ${booking.code}` },
        });
        toast('Report sent. Our safety desk will review it.');
      } catch (error) {
        toastError(error);
      }
    }
  });

  liveEl.addEventListener('submit', async (event) => {
    const form = event.target.closest('#verify-form');
    if (!form) return;
    event.preventDefault();
    const code = form.querySelector('[name="code"]').value.trim();
    if (!code) return;
    try {
      const result = await api('/driver/verify', { method: 'POST', body: { code } });
      toast(`Verified — this pass belongs to ${result.booking.customer.name}.`);
      form.reset();
    } catch (error) {
      toastError(error);
    }
  });

  passEl.addEventListener('click', (event) => {
    if (event.target.closest('[data-act="show-qr"]')) showQr(booking);
  });

  supportEl.addEventListener('click', async (event) => {
    if (!event.target.closest('[data-act="report"]')) return;
    const reason = await promptModal({
      title: 'Report a safety issue',
      eyebrow: `Ride ${booking.code}`,
      label: 'What went wrong?',
      placeholder: 'Unsafe driving, harassment, wrong route…',
      confirmLabel: 'Send to safety desk',
      multiline: true,
      maxLength: 200,
      hint: '3–200 characters. Our team reads every report.',
    });
    if (!reason) return;
    try {
      await api('/reports', {
        method: 'POST',
        body: { target_type: 'booking', target_id: booking.id, reason: reason.trim(), detail: `Ride ${booking.code}` },
      });
      toast('Report sent. Our safety desk will review it.');
    } catch (error) {
      toastError(error);
    }
  });

  const renderAll = (b, force = false) => {
    const changed = force || b.status !== renderedStatus;
    renderLive(b);
    if (changed) {
      renderPass(b);
      renderChat(b);
      renderedStatus = b.status;
    }
    if (b.driver?.lat && b.driver?.lng && map.ready) {
      map.setCar(b.driver.lat, b.driver.lng);
    }
    if (b.status === 'completed' || b.status === 'cancelled') {
      poller?.stop();
    }
  };

  renderLive(booking);
  renderPass(booking);
  renderChat(booking);
  renderSupport(booking);
  renderedStatus = booking.status;

  if (!['completed', 'cancelled'].includes(booking.status)) {
    poller = createPoller(async () => {
      const fresh = await api(`/bookings/${booking.id}`);
      const statusChanged = fresh.status !== booking.status;
      booking = fresh;
      if (statusChanged) {
        renderAll(fresh, true);
        window.dispatchEvent(new CustomEvent('notifications:refresh'));
        if (['accepted', 'arriving', 'completed'].includes(fresh.status)) {
          toast({
            accepted: 'A driver accepted your ride.',
            arriving: 'Your driver is arriving.',
            completed: 'Trip completed.',
          }[fresh.status], { type: 'info' });
        }
      } else if (fresh.driver?.lat && fresh.driver?.lng && map.ready) {
        map.setCar(fresh.driver.lat, fresh.driver.lng);
      }
    }, 6000);
  }

  return () => {
    poller?.stop();
    chat?.stop();
    map.destroy();
  };
}
