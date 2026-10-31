import { api } from '../api.js';
import { state } from '../store.js';
import { icon } from '../ui/icons.js';
import {
  esc, money, dateTime, countdown, minutes, avatar, statusBadge, relative,
} from '../ui/format.js';
import { emptyState, errorBlock, skeletons } from '../ui/layout.js';
import { memberList, themeIcon, themeLabel, themeImage } from '../ui/booking.js';
import { RideMap, calcRoadDistance, fetchStreetRoute, locateUser } from '../ui/map.js';
import { mountChat } from '../ui/chat.js';
import { confirmModal, promptModal } from '../ui/modal.js';
import { toast, toastError } from '../ui/toast.js';
import { $, withBusy } from '../ui/dom.js';
import { ridePrefill } from './ride.js';

export default async function renderTour(view, ctx) {
  const id = Number(ctx.params.id);
  if (!Number.isFinite(id)) {
    ctx.navigate('/tours', { replace: true });
    return () => {};
  }

  view.innerHTML = `<div class="tour-detail-loading">${skeletons(2, 'panel-skeleton')}</div>`;

  let tour;
  try {
    tour = await api(`/tours/${id}`);
  } catch (error) {
    view.innerHTML = `<div class="panel narrow-panel">
      ${errorBlock(
        error.status === 404 ? 'That tour is no longer on the schedule.' : error.message,
        { id: 'tour-retry' },
      )}
      <a class="btn btn-ghost" href="#/tours">${icon('arrow-left', 15)} All city tours</a>
    </div>`;
    $('#tour-retry', view)?.addEventListener('click', () => void ctx.navigate(`/tour/${id}`));
    return () => {};
  }

  document.title = `${tour.title} · AddisGo`;

  let map = null;
  let chat = null;

  const paint = () => {
    const user = state.user;
    const isHost = tour.is_host;
    const isMember = tour.is_member;
    const started = new Date(tour.starts_at).getTime() <= Date.now();
    const open = tour.status === 'upcoming' && !started && tour.spots_left > 0;
    const canChat = Boolean(user) && (isMember || user.role === 'admin');

    const heroImg = tour.image_url || themeImage(tour.theme);
    view.innerHTML = `
      <section class="tour-detail">
        <div class="tour-hero theme-${esc(tour.theme || 'custom')}">
          <img src="${esc(heroImg)}" alt="" class="tour-hero-bg-photo" aria-hidden="true" />
          <div class="tour-hero-overlay" aria-hidden="true"></div>
          <div class="tour-hero-inner">
            <a class="back-link back-link-light" href="#/tours">${icon('arrow-left', 16)} All tours</a>
            <div class="tour-hero-badges">
              <span class="tour-theme">${icon(themeIcon(tour.theme), 15)} ${esc(themeLabel(tour.theme))}</span>
              ${statusBadge(tour.status)}
              ${tour.status === 'upcoming' ? `<span class="badge badge-soft">${esc(countdown(tour.starts_at))}</span>` : ''}
            </div>
            <h1>${esc(tour.title)}</h1>
            <p class="tour-hero-sub">${icon('map-pin', 15)} ${esc(tour.meeting_point)} · ${icon('calendar', 15)} ${esc(dateTime(tour.starts_at))}</p>
            <div class="tour-hero-foot">
              <div class="tour-host-inline">
                ${avatar(tour.host, 40)}
                <span><strong>${esc(tour.host.name)}</strong><small>Host · ${esc((tour.host.languages || []).join(' · '))}</small></span>
              </div>
              <div class="tour-hero-price">
                <span>${tour.price === 0 ? 'Free' : money(tour.price)}<small> per person</small></span>
                <em>${tour.member_count} of ${tour.capacity} going</em>
              </div>
            </div>
          </div>
        </div>

        <div class="tour-detail-grid">
          <div class="tour-main">
            <section class="panel">
              <h2 class="panel-title">About this tour</h2>
              <p class="tour-about">${esc(tour.description)}</p>
              <div class="fact-grid">
                ${facts(tour).map((f) => `
                  <div class="fact">
                    <span class="fact-icon">${icon(f.icon, 17)}</span>
                    <span><small>${esc(f.label)}</small><strong>${esc(f.value)}</strong>${f.hint ? `<em>${esc(f.hint)}</em>` : ''}</span>
                  </div>
                `).join('')}
              </div>
            </section>

            <section class="panel map-panel tour-directions-panel">
              <div class="panel-head-row">
                <div>
                  <h2>Meeting point &amp; live directions</h2>
                  <p class="muted">Live route from your current location to the group meeting spot</p>
                </div>
                <div class="map-actions-group">
                  <button type="button" class="btn btn-xs btn-primary" data-act="ride-here">
                    ${icon('car', 14)} Ride here with AddisGo
                  </button>
                  <a class="btn btn-xs btn-ghost" id="google-maps-ext-link" href="https://www.google.com/maps/dir/?api=1&destination=${esc(tour.lat)},${esc(tour.lng)}" target="_blank" rel="noopener noreferrer">
                    ${icon('navigation', 14)} Google Maps ${icon('external-link', 12)}
                  </a>
                </div>
              </div>

              <!-- Google Maps-style Direction Header Strip -->
              <div class="map-directions-bar" id="tour-directions-bar">
                <div class="route-origin-dest">
                  <div class="route-point-chip origin-chip">
                    <span class="loc-puck-mini"></span>
                    <span class="route-point-text" id="route-user-loc-label">Locating you…</span>
                  </div>
                  <div class="route-arrow-connector">➔</div>
                  <div class="route-point-chip dest-chip">
                    <span class="loc-flag-mini"></span>
                    <strong class="route-point-text">${esc(tour.meeting_point)}</strong>
                  </div>
                </div>

                <div class="route-metrics-strip" id="route-metrics-strip">
                  <span class="route-metric-pill pill-distance" id="metric-distance">
                    ${icon('map', 13)} Calculating route…
                  </span>
                  <span class="route-metric-pill pill-drive" id="metric-drive">
                    ${icon('car', 13)} ~
                  </span>
                  <span class="route-metric-pill pill-walk" id="metric-walk">
                    ${icon('user', 13)} ~
                  </span>
                </div>
              </div>

              <!-- Map Container with Floating GPS Locate Button -->
              <div class="tour-map-wrapper">
                <div id="tour-map" class="tour-map" aria-label="Map showing route from your current location to meeting point"></div>
                <button type="button" class="map-locate-fab" id="map-locate-fab" title="Recenter to my current location" aria-label="Locate me">
                  ${icon('navigation', 16)}
                </button>
                <div class="map-origin-notice" id="map-origin-notice" hidden></div>
              </div>

              <div class="map-foot">
                <div class="map-coords-info">
                  <span class="badge badge-soft tone-green" id="map-gps-status">
                    ${icon('check-circle', 12)} GPS Connected
                  </span>
                  <span class="muted">${esc(tour.lat.toFixed(4))}, ${esc(tour.lng.toFixed(4))}</span>
                </div>
                <div class="map-foot-links">
                  <button type="button" class="text-btn btn-sm" id="btn-recenter-route">
                    ${icon('refresh', 13)} Recenter route
                  </button>
                  <a class="text-link" id="google-maps-full-link" href="https://www.google.com/maps/dir/?api=1&destination=${esc(tour.lat)},${esc(tour.lng)}" target="_blank" rel="noopener noreferrer">
                    Open in Google Maps ${icon('external-link', 13)}
                  </a>
                </div>
              </div>
            </section>

            <section class="panel">
              <div class="panel-head-row">
                <div><h2>Who is coming</h2><p>${tour.member_count} of ${tour.capacity} spots taken${tour.spots_left > 0 ? ` · ${tour.spots_left} left` : ' · full'}</p></div>
                ${icon('users', 20)}
              </div>
              ${memberList(tour.members, tour.host.id)}
            </section>

            <section class="panel" id="tour-chat-panel">
              <div class="panel-head-row">
                <div>
                  <h2>Group chat</h2>
                  <p>${canChat ? 'Coordinate meeting details with your host and group.' : 'Join the tour to read and post in the group chat.'}</p>
                </div>
                ${icon('message', 20)}
              </div>
              <div id="tour-chat"></div>
            </section>
          </div>

          <aside class="tour-side">
            <section class="panel join-card">
              <div class="join-head">
                <span class="join-price">${tour.price === 0 ? 'Free' : money(tour.price)}</span>
                <span class="join-per">per person</span>
              </div>
              <p class="join-when">${icon('calendar', 14)} ${esc(dateTime(tour.starts_at))}</p>
              <p class="join-when">${icon('map-pin', 14)} ${esc(tour.meeting_point)}</p>
              <div class="join-progress">
                <div class="progress"><span style="width:${Math.min(100, Math.round((tour.member_count / Math.max(1, tour.capacity)) * 100))}%"></span></div>
                <small>${tour.spots_left > 0 ? `${tour.spots_left} of ${tour.capacity} spots left` : 'This tour is full'}</small>
              </div>
              <div class="join-actions" id="join-actions">${joinActions(tour, { isHost, isMember, open, started })}</div>
              <p class="fine-print">${icon('shield', 13)} Hosts are verified by AddisGo. Payment happens directly with your host on the day.</p>
            </section>

            <section class="panel">
              <h2 class="panel-title">Your host</h2>
              <div class="host-card">
                ${avatar(tour.host, 52)}
                <div>
                  <strong>${esc(tour.host.name)}</strong>
                  <span>${esc((tour.host.languages || []).join(' · ') || 'English')}</span>
                </div>
              </div>
              <p class="host-bio">${esc(tour.host.bio || 'A local host ready to show you their Addis.')}</p>
              <div class="host-badges">
                ${tour.host.is_verified ? `<span class="badge badge-green">${icon('check-circle', 13)} Verified host</span>` : ''}
                <span class="badge badge-muted">${icon('star', 13)} Local knowledge</span>
              </div>
            </section>

            <section class="panel safety-panel">
              <span class="safety-icon">${icon('shield', 20)}</span>
              <div>
                <strong>Small group, safe by design</strong>
                <p>Group sizes are capped. Chats are limited to members, and every report goes straight to our safety desk.</p>
                <button type="button" class="text-btn" data-act="report">${icon('flag', 14)} Report this tour</button>
              </div>
            </section>
          </aside>
        </div>
      </section>
    `;

    mountMap();
    mountGroupChat(canChat);
  };

  let userLocation = null;

  async function mountMap() {
    const el = $('#tour-map', view);
    if (!el) return;
    map = new RideMap(el, { center: { lat: tour.lat, lng: tour.lng }, zoom: 14 });
    if (!map.ready) return;

    // 1. Destination marker (tour meeting point)
    map.setDropoff({ lat: tour.lat, lng: tour.lng, label: tour.meeting_point });

    // 2. Locate user and build live Google Maps style route
    await updateUserLocationAndRoute();

    // 3. Attach click handlers for GPS button and Recenter
    const locateBtn = $('#map-locate-fab', view);
    locateBtn?.addEventListener('click', (e) => {
      e.preventDefault();
      void updateUserLocationAndRoute(true);
    });

    const recenterBtn = $('#btn-recenter-route', view);
    recenterBtn?.addEventListener('click', (e) => {
      e.preventDefault();
      if (userLocation) {
        map.fitPoints([[userLocation.lat, userLocation.lng], [tour.lat, tour.lng]], {
          padding: [48, 48],
          maxZoom: 15,
        });
      } else {
        map.panTo(tour.lat, tour.lng, 14);
      }
    });
  }

  async function updateUserLocationAndRoute(forceRefresh = false) {
    const userLabelEl = $('#route-user-loc-label', view);
    const distEl = $('#metric-distance', view);
    const driveEl = $('#metric-drive', view);
    const walkEl = $('#metric-walk', view);
    const noticeEl = $('#map-origin-notice', view);
    const gpsStatusEl = $('#map-gps-status', view);
    const gmapsExtLink = $('#google-maps-ext-link', view);
    const gmapsFullLink = $('#google-maps-full-link', view);
    const fabBtn = $('#map-locate-fab', view);

    if (fabBtn) fabBtn.classList.add('is-locating');

    let coords = null;
    let isFallback = false;

    try {
      coords = await locateUser({ timeout: 6000 });
      // Verify if coordinates are reasonably near Addis Ababa (within ~75km)
      const distFromAddis = calcRoadDistance(coords.lat, coords.lng, tour.lat, tour.lng);
      if (distFromAddis > 75) {
        // Connected from outside Addis - provide Bole Medhanialem so realistic local route is drawn
        coords = { lat: 8.9950, lng: 38.7870, label: 'Bole Medhanialem' };
        isFallback = true;
      }
    } catch {
      // Permission blocked or timeout - fall back to Bole Medhanialem
      coords = { lat: 8.9950, lng: 38.7870, label: 'Bole Medhanialem' };
      isFallback = true;
    } finally {
      if (fabBtn) fabBtn.classList.remove('is-locating');
    }

    userLocation = coords;
    const locLabel = coords.label || (isFallback ? 'Bole Medhanialem (Addis)' : 'Your current location');

    // 1. Current location marker (pulsing Google Maps blue puck)
    map.setCurrentLocation({ lat: coords.lat, lng: coords.lng, label: locLabel });

    // 2. Fetch real on-ground shortest street route
    const routeData = await fetchStreetRoute(coords.lat, coords.lng, tour.lat, tour.lng);
    const distKm = routeData.distance_km || Math.round(calcRoadDistance(coords.lat, coords.lng, tour.lat, tour.lng) * 10) / 10;
    const driveMin = routeData.duration_min || Math.max(3, Math.round(distKm * 2.5));
    const walkMin = Math.max(5, Math.round(distKm * 12.5));

    // 3. Render real on-ground street polyline
    map.setRoute(routeData.points, {
      color: '#1a73e8',
      haloColor: 'rgba(66, 133, 244, 0.35)',
      weight: 5,
      dashed: false,
    });

    // 4. Fit bounds to display both locations together
    map.fitPoints([[coords.lat, coords.lng], [tour.lat, tour.lng]], {
      padding: [48, 48],
      maxZoom: 15,
    });

    // 5. Update UI labels & links
    if (userLabelEl) {
      userLabelEl.textContent = locLabel;
    }
    if (distEl) distEl.innerHTML = `${icon('map', 13)} <strong>${distKm} km</strong> away`;
    if (driveEl) driveEl.innerHTML = `${icon('car', 13)} <strong>${driveMin} min</strong> ride`;
    if (walkEl) walkEl.innerHTML = `${icon('user', 13)} <strong>${walkMin} min</strong> walk`;

    const gmapsUrl = `https://www.google.com/maps/dir/?api=1&origin=${coords.lat},${coords.lng}&destination=${tour.lat},${tour.lng}`;
    if (gmapsExtLink) gmapsExtLink.href = gmapsUrl;
    if (gmapsFullLink) gmapsFullLink.href = gmapsUrl;

    if (gpsStatusEl) {
      if (isFallback) {
        gpsStatusEl.className = 'badge badge-soft tone-amber';
        gpsStatusEl.innerHTML = `${icon('map-pin', 12)} Local Addis point`;
      } else {
        gpsStatusEl.className = 'badge badge-soft tone-green';
        gpsStatusEl.innerHTML = `${icon('check-circle', 12)} GPS Connected`;
      }
    }

    if (noticeEl) {
      if (isFallback) {
        noticeEl.hidden = false;
        noticeEl.innerHTML = `${icon('info', 12)} Showing route from Bole Medhanialem. Click <em>${icon('navigation', 12)}</em> to locate your GPS.`;
      } else {
        noticeEl.hidden = true;
      }
    }
  }

  function mountGroupChat(canChat) {
    chat?.stop();
    chat = null;
    const host = $('#tour-chat', view);
    if (!host) return;
    if (!state.user) {
      host.innerHTML = `<div class="chat-gate">
        <p>${icon('lock', 16)} Sign in and join this tour to open the group chat.</p>
        <a class="btn btn-sm btn-primary" href="#/login?next=${encodeURIComponent(`/tour/${tour.id}`)}">Sign in</a>
      </div>`;
      return;
    }
    chat = mountChat(host, {
      title: `${tour.title}`,
      participants: (tour.members || []).map((m) => ({ name: m.name, role: 'Member', avatar_color: m.avatar_color })),
      load: () => api(`/tours/${tour.id}/messages`),
      send: (body) => api(`/tours/${tour.id}/messages`, { method: 'POST', body: { body } }),
      interval: 6000,
      disabled: !canChat,
      disabledText: tour.status !== 'upcoming'
        ? 'This tour chat is closed.'
        : 'Join the tour to read and post in the group chat.',
      emptyText: 'No messages yet — say hello and ask your host anything.',
      me: state.user,
    });
  }

  const onViewClick = async (event) => {
    const button = event.target.closest('[data-act]');
    if (!button) return;
    const act = button.dataset.act;

    if (act === 'ride-here') {
      if (userLocation) {
        ridePrefill.pickup = {
          lat: userLocation.lat,
          lng: userLocation.lng,
          label: userLocation.label || 'Current location',
        };
      }
      ridePrefill.dropoff = { lat: tour.lat, lng: tour.lng, label: tour.meeting_point };
      ctx.navigate('/ride');
      return;
    }

    if (act === 'open-chat') {
      const panel = $('#tour-chat-panel', view);
      panel?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      panel?.querySelector('.chat-input')?.focus({ preventScroll: true });
      return;
    }

    if (act === 'report') {
      const reason = await promptModal({
        title: 'Report this tour',
        eyebrow: tour.title,
        label: 'What is wrong?',
        placeholder: 'Unsafe meeting point, misleading price, harassment…',
        confirmLabel: 'Send to safety desk',
        multiline: true,
        maxLength: 200,
        hint: '3–200 characters. Our team reads every report.',
      });
      if (!reason) return;
      try {
        await api('/reports', {
          method: 'POST',
          body: { target_type: 'tour', target_id: tour.id, reason, detail: `Tour ${tour.id} — ${tour.title}` },
        });
        toast('Report sent. Our safety desk will review it.');
      } catch (error) {
        toastError(error);
      }
      return;
    }

    if (!state.user) {
      ctx.navigate(`/login?next=${encodeURIComponent(`/tour/${tour.id}`)}`);
      return;
    }

    if (act === 'join') {
      await withBusy(button, async () => {
        try {
          tour = await api(`/tours/${tour.id}/join`, { method: 'POST' });
          toast('You are in. Say hello in the group chat.');
          paint();
        } catch (error) {
          toastError(error);
        }
      });
      return;
    }

    if (act === 'leave') {
      const ok = await confirmModal({
        title: 'Leave this tour?',
        message: 'Your spot will be released to other travellers.',
        confirmLabel: 'Leave tour',
        cancelLabel: 'Stay',
        danger: true,
      });
      if (!ok) return;
      await withBusy(button, async () => {
        try {
          tour = await api(`/tours/${tour.id}/leave`, { method: 'POST' });
          toast('You left the tour.');
          paint();
        } catch (error) {
          toastError(error);
        }
      });
      return;
    }

    if (act === 'cancel-tour') {
      const ok = await confirmModal({
        title: 'Cancel this tour?',
        message: 'Everyone who joined will be notified. This cannot be undone.',
        confirmLabel: 'Cancel tour',
        cancelLabel: 'Keep it running',
        danger: true,
      });
      if (!ok) return;
      await withBusy(button, async () => {
        try {
          tour = await api(`/tours/${tour.id}/cancel`, { method: 'POST' });
          toast('Tour cancelled. Members have been notified.');
          paint();
        } catch (error) {
          toastError(error);
        }
      });
    }
  };

  view.addEventListener('click', onViewClick);

  paint();

  return () => {
    view.removeEventListener('click', onViewClick);
    chat?.stop();
    map?.destroy();
  };
}

function facts(tour) {
  return [
    { icon: 'calendar', label: 'Starts', value: dateTime(tour.starts_at), hint: tour.status === 'upcoming' ? countdown(tour.starts_at) : '' },
    { icon: 'clock', label: 'Length', value: minutes(tour.duration_min) },
    { icon: 'users', label: 'Group size', value: `${tour.member_count} of ${tour.capacity}`, hint: tour.spots_left > 0 ? `${tour.spots_left} spots left` : 'Full' },
    { icon: 'wallet', label: 'Price', value: tour.price === 0 ? 'Free' : money(tour.price) },
    { icon: 'map-pin', label: 'Meeting point', value: tour.meeting_point },
    { icon: 'compass', label: 'Theme', value: themeLabel(tour.theme) },
  ];
}

function joinActions(tour, { isHost, isMember, open, started }) {
  if (tour.status !== 'upcoming') {
    return `<span class="join-state">${icon('ban', 16)} This tour is ${esc(tour.status)}</span>
      <a class="btn btn-ghost btn-block" href="#/tours">Find another tour</a>`;
  }
  if (isHost) {
    return `<span class="join-state is-host">${icon('sparkle', 16)} You are hosting this tour</span>
      <span class="muted join-note">Members can join until the tour starts.</span>
      <button type="button" class="btn btn-ghost btn-block btn-danger-text" data-act="cancel-tour">${icon('ban', 15)} Cancel tour</button>`;
  }
  if (isMember) {
    return `<span class="join-state is-member">${icon('check-circle', 16)} You are going</span>
      <button type="button" class="btn btn-primary btn-block" data-act="open-chat">${icon('message', 16)} Open group chat</button>
      ${started ? '' : `<button type="button" class="btn btn-ghost btn-block" data-act="leave">${icon('minus', 15)} Leave tour</button>`}`;
  }
  if (started) {
    return `<span class="join-state">${icon('clock', 16)} This tour has already started</span>
      <a class="btn btn-ghost btn-block" href="#/tours">Browse upcoming tours</a>`;
  }
  if (!open) {
    return `<span class="join-state">${icon('users', 16)} This tour is full</span>
      <a class="btn btn-ghost btn-block" href="#/tours">Find another tour</a>`;
  }
  return `<button type="button" class="btn btn-primary btn-lg btn-block" data-act="join">${icon('plus', 17)} Join this tour</button>
    <span class="muted join-note">${esc(relative(tour.starts_at))} · ${tour.spots_left} spots left</span>`;
}
