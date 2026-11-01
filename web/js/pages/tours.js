import { api, newIdempotencyKey } from '../api.js';
import { state } from '../store.js';
import { icon } from '../ui/icons.js';
import { esc, money, dateTime, countdown, minutes } from '../ui/format.js';
import { pageHead, emptyState, errorBlock, skeletons } from '../ui/layout.js';
import { tourCard, themeIcon, themeLabel } from '../ui/booking.js';
import { RideMap } from '../ui/map.js';
import { openModal } from '../ui/modal.js';
import { toast, toastError } from '../ui/toast.js';
import { $, withBusy, formValues } from '../ui/dom.js';
import { PLACES, ADDIS_CENTER, placeByName } from '../places.js';

const THEMES = ['entoto', 'merkato', 'museum', 'bole', 'custom'];
const THEME_COPY = {
  entoto: 'Nature & views',
  merkato: 'Markets & food',
  museum: 'History & culture',
  bole: 'Modern Addis',
  custom: 'Local pick',
};

const SCOPES = [
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'mine', label: 'My tours' },
  { key: 'past', label: 'Past' },
];

export default async function renderTours(view, ctx) {
  const user = state.user;
  let scope = ctx.query.get('scope') || 'upcoming';
  if (!SCOPES.some((s) => s.key === scope)) scope = 'upcoming';
  let theme = ctx.query.get('theme') || 'all';
  if (theme !== 'all' && !THEMES.includes(theme)) theme = 'all';
  let query = '';

  view.innerHTML = `
    <section class="tours-page">
      ${pageHead({
        eyebrow: 'Small groups, real locals',
        title: 'City tours worth waking up for.',
        description: 'Sunset ridges, spice markets, museum mornings and food crawls — hosted by guides who live here.',
        actions: user
          ? `<button type="button" class="btn btn-primary" id="host-tour">${icon('plus', 17)} Host a tour</button>`
          : `<a class="btn btn-primary" href="#/login?next=${encodeURIComponent('/tours')}">${icon('compass', 17)} Sign in to join</a>`,
      })}

      <section class="tours-toolbar panel">
        <div class="tabs" role="tablist" aria-label="Tour scope">
          ${SCOPES.map((s) => `<button type="button" class="tab ${s.key === scope ? 'is-active' : ''}" data-scope="${s.key}" role="tab" aria-selected="${s.key === scope}">${esc(s.label)}</button>`).join('')}
        </div>
        <label class="search-field">
          ${icon('search', 15)}
          <input type="search" id="tour-search" placeholder="Search tours or meeting points" aria-label="Search tours" />
        </label>
      </section>

      <div class="theme-chips" role="group" aria-label="Filter by theme">
        <button type="button" class="chip ${theme === 'all' ? 'is-active' : ''}" data-theme="all">${icon('compass', 14)} All tours</button>
        ${THEMES.map((t) => `<button type="button" class="chip ${theme === t ? 'is-active' : ''}" data-theme="${t}">${icon(themeIcon(t), 14)} ${esc(THEME_COPY[t])}</button>`).join('')}
      </div>

      <div id="tour-grid" class="tour-grid">${skeletons(3, 'tour-skeleton')}</div>

      <section class="panel tours-cta">
        <div>
          <h2>Know Addis better than a guide? Prove it.</h2>
          <p>Host up to six upcoming tours, set your own group size, and get paid directly. We handle the safety checks and the group chat.</p>
        </div>
        ${user
          ? `<button type="button" class="btn btn-primary" data-host-cta>${icon('plus', 16)} Start hosting</button>`
          : `<a class="btn btn-primary" href="#/register">${icon('arrow-right', 16)} Create a free account</a>`}
      </section>
    </section>
  `;

  const grid = $('#tour-grid', view);
  const search = $('#tour-search', view);
  let tours = [];
  let loadToken = 0;

  const load = async () => {
    const token = ++loadToken;
    grid.innerHTML = skeletons(3, 'tour-skeleton');
    const params = new URLSearchParams();
    if (scope === 'mine') params.set('mine', '1');
    if (scope === 'past') params.set('past', '1');
    if (query) params.set('q', query);
    try {
      const data = await api(`/tours${params.toString() ? `?${params}` : ''}`);
      if (token !== loadToken) return;
      tours = data.tours || [];
      draw();
    } catch (error) {
      if (token !== loadToken) return;
      grid.innerHTML = errorBlock(error.message, { id: 'tours-retry' });
      $('#tours-retry', grid)?.addEventListener('click', () => void load());
    }
  };

  const draw = () => {
    const filtered = tours.filter((t) => theme === 'all' || t.theme === theme);
    if (!filtered.length) {
      grid.innerHTML = emptyState({
        icon: scope === 'past' ? 'clock' : 'compass',
        title: scope === 'mine' && !state.user ? 'Sign in to see your tours' : 'No tours match this view',
        text: scope === 'past'
          ? 'Tours you have attended will appear here once they finish.'
          : 'Try another theme, clear the search, or host the tour you want to see.',
        action: state.user
          ? '<button type="button" class="btn btn-sm btn-primary" data-host-cta>Host a tour</button>'
          : '<a class="btn btn-sm btn-primary" href="#/login">Sign in</a>',
      });
      return;
    }
    grid.innerHTML = filtered.map((tour) => `
      <div class="tour-grid-item">
        ${tourCard(tour, { href: `#/tour/${tour.id}` })}
        <div class="tour-quick-actions">
          ${quickAction(tour)}
        </div>
      </div>
    `).join('');
  };

  function quickAction(tour) {
    if (!state.user) {
      return `<a class="btn btn-sm btn-ghost btn-block" href="#/login?next=${encodeURIComponent(`/tour/${tour.id}`)}">${icon('lock', 14)} Sign in to join</a>`;
    }
    if (tour.is_host) {
      return `<a class="btn btn-sm btn-ghost btn-block" href="#/tour/${tour.id}">${icon('settings', 14)} Manage your tour</a>`;
    }
    if (tour.is_member) {
      return `<a class="btn btn-sm btn-go btn-block" href="#/tour/${tour.id}">${icon('check', 14)} You are going — open chat</a>`;
    }
    if (tour.status !== 'upcoming' || tour.spots_left <= 0) {
      return `<a class="btn btn-sm btn-ghost btn-block" href="#/tour/${tour.id}">${icon('eye', 14)} View details</a>`;
    }
    return `<button type="button" class="btn btn-sm btn-primary btn-block" data-join="${tour.id}">${icon('plus', 14)} Join · ${tour.price === 0 ? 'Free' : money(tour.price)}</button>`;
  }

  view.querySelectorAll('[data-scope]').forEach((btn) => {
    btn.addEventListener('click', () => {
      scope = btn.dataset.scope;
      view.querySelectorAll('[data-scope]').forEach((b) => {
        b.classList.toggle('is-active', b === btn);
        b.setAttribute('aria-selected', String(b === btn));
      });
      if (scope === 'mine' && !state.user) {
        ctx.navigate(`/login?next=${encodeURIComponent('/tours?scope=mine')}`);
        return;
      }
      void load();
    });
  });

  view.querySelectorAll('[data-theme]').forEach((btn) => {
    btn.addEventListener('click', () => {
      theme = btn.dataset.theme;
      view.querySelectorAll('[data-theme]').forEach((b) => b.classList.toggle('is-active', b === btn));
      draw();
    });
  });

  let searchTimer = null;
  search?.addEventListener('input', () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => {
      query = search.value.trim();
      void load();
    }, 320);
  });

  grid.addEventListener('click', async (event) => {
    const joinBtn = event.target.closest('[data-join]');
    const hostBtn = event.target.closest('[data-host-cta]');
    if (hostBtn) {
      openHostModal(ctx, () => void load());
      return;
    }
    if (!joinBtn) return;
    if (!state.user) {
      ctx.navigate(`/login?next=${encodeURIComponent('/tours')}`);
      return;
    }
    await withBusy(joinBtn, async () => {
      try {
        const updated = await api(`/tours/${joinBtn.dataset.join}/join`, { method: 'POST', idempotencyKey: newIdempotencyKey() });
        tours = tours.map((t) => (t.id === updated.id ? updated : t));
        draw();
        toast(`You are going to ${updated.title}. The group chat is open.`);
      } catch (error) {
        toastError(error);
      }
    });
  });

  const hostClick = () => openHostModal(ctx, () => void load());
  $('#host-tour', view)?.addEventListener('click', hostClick);
  view.querySelectorAll('[data-host-cta]').forEach((btn) => btn.addEventListener('click', hostClick));

  void load();
  return () => {
    window.clearTimeout(searchTimer);
  };
}

/* ------------------------------------------------------------------ */
/* Host a tour                                                         */
/* ------------------------------------------------------------------ */

function openHostModal(ctx, onCreated) {
  if (!state.user) {
    ctx.navigate(`/login?next=${encodeURIComponent('/tours')}`);
    return;
  }
  if (state.user.role === 'driver') {
    toast('Switch to a rider account to host a city tour.', { type: 'warning' });
    return;
  }

  let point = { lat: 8.995, lng: 38.787, label: 'Bole Medhanialem' };

  const modal = openModal({
    title: 'Host a city tour',
    eyebrow: 'Small groups, honest pricing',
    size: 'lg',
    body: `
      <form class="form" id="host-form" novalidate>
        <div class="form-alert" id="host-error" role="alert" hidden></div>
        <label class="field">
          <span class="field-label">Tour title</span>
          <input class="field-input" name="title" maxlength="80" placeholder="Sunset over Entoto" required />
        </label>
        <div class="field field-wide photo-attach-field">
          <span class="field-label">Tour photo</span>
          <div class="photo-attach-row">
            <div class="photo-preview-box" id="host-photo-preview">
              <span class="photo-placeholder">${icon('image', 22)}<span>No photo</span></span>
            </div>
            <div class="photo-inputs">
              <div class="photo-btn-group">
                <label class="btn btn-sm btn-outline photo-upload-btn">
                  ${icon('upload', 14)} Attach photo
                  <input type="file" accept="image/jpeg,image/png,image/webp" id="host-photo-file" style="display:none;" />
                </label>
                <span class="field-hint" style="margin:0;">JPEG, PNG or WebP</span>
              </div>
              <input type="url" name="image_url" id="host-photo-url" placeholder="Or paste photo URL (https://...)" class="field-input photo-url-input" />
            </div>
          </div>
        </div>
        <label class="field">
          <span class="field-label">What will the group do?</span>
          <textarea class="field-input" name="description" rows="4" maxlength="1200" placeholder="Where you meet, what you will see, what to bring…" required></textarea>
          <span class="field-hint">20–1200 characters. Be specific — guests decide from this.</span>
        </label>

        <div class="field-grid">
          <label class="field">
            <span class="field-label">Theme</span>
            <select class="field-input" name="theme">
              ${THEMES.map((t) => `<option value="${t}">${esc(THEME_COPY[t])}</option>`).join('')}
            </select>
          </label>
          <label class="field">
            <span class="field-label">Group size</span>
            <input class="field-input" name="capacity" type="number" min="2" max="30" value="8" required />
          </label>
          <label class="field">
            <span class="field-label">Duration (minutes)</span>
            <input class="field-input" name="duration_min" type="number" min="30" max="720" step="15" value="90" required />
          </label>
          <label class="field">
            <span class="field-label">Price per person (ETB)</span>
            <input class="field-input" name="price" type="number" min="0" max="100000" step="50" value="900" required />
          </label>
          <label class="field field-wide">
            <span class="field-label">Starts at</span>
            <input class="field-input" name="starts_at" type="datetime-local" required />
            <span class="field-hint">Local Addis time. Up to 90 days ahead.</span>
          </label>
        </div>

        <div class="field">
          <span class="field-label">Meeting point</span>
          <div class="meeting-row">
            <select class="field-input" id="meeting-place">
              ${PLACES.map((p) => `<option value="${esc(p.name)}" ${p.name === 'Bole Medhanialem' ? 'selected' : ''}>${esc(p.name)} · ${esc(p.area)}</option>`).join('')}
            </select>
            <input class="field-input" name="meeting_point" maxlength="140" value="Bole Medhanialem" placeholder="Name the exact gate or corner" required />
          </div>
          <div id="host-map" class="host-map" aria-label="Choose the meeting point on the map"></div>
          <span class="field-hint" id="host-map-hint">Tap the map to fine-tune the meeting pin.</span>
        </div>
      </form>
    `,
    footer: `
      <button type="button" class="btn btn-ghost" data-close>Cancel</button>
      <button type="button" class="btn btn-primary" data-create>${icon('check', 16)} Publish tour</button>
    `,
  });

  const form = modal.body.querySelector('#host-form');
  const errorBox = modal.body.querySelector('#host-error');
  const placeSelect = modal.body.querySelector('#meeting-place');
  const meetingInput = form.querySelector('[name="meeting_point"]');
  const startsInput = form.querySelector('[name="starts_at"]');
  const map = new RideMap(modal.body.querySelector('#host-map'), { center: point, zoom: 13 });

  const now = new Date(Date.now() + 26 * 3600_000);
  now.setMinutes(0, 0, 0);
  const pad = (n) => String(n).padStart(2, '0');
  startsInput.value = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:00`;
  startsInput.min = new Date(Date.now() + 30 * 60000).toISOString().slice(0, 16);

  const setPoint = (lat, lng, label = null) => {
    point = { lat, lng };
    map.setDropoff({ lat, lng, label: label || 'Meeting point' });
    map.invalidate();
  };
  map.onPick('meeting', (next) => {
    setPoint(next.lat, next.lng);
    modal.body.querySelector('#host-map-hint').textContent = 'Meeting pin moved. Add a landmark name above.';
    map.clearPick();
  });
  setPoint(point.lat, point.lng, 'Bole Medhanialem');

  const photoFileInput = modal.body.querySelector('#host-photo-file');
  const photoUrlInput = modal.body.querySelector('#host-photo-url');
  const photoPreview = modal.body.querySelector('#host-photo-preview');

  const updatePhotoPreview = (url) => {
    const clean = String(url || '').trim();
    if (clean) {
      photoPreview.innerHTML = `
        <img src="${esc(clean)}" alt="Preview" class="photo-preview-img" onerror="this.onerror=null;this.src='data:image/svg+xml;utf8,<svg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'40\\' height=\\'40\\' viewBox=\\'0 0 24 24\\' fill=\\'none\\' stroke=\\'%23888\\' stroke-width=\\'2\\'><rect width=\\'18\\' height=\\'18\\' x=\\'3\\' y=\\'3\\' rx=\\'2\\'/></svg>';" />
        <button type="button" class="photo-remove-btn" id="host-photo-remove" title="Remove photo" aria-label="Remove photo">✕</button>
      `;
      photoPreview.querySelector('#host-photo-remove')?.addEventListener('click', () => {
        photoUrlInput.value = '';
        if (photoFileInput) photoFileInput.value = '';
        updatePhotoPreview('');
      });
    } else {
      photoPreview.innerHTML = `<span class="photo-placeholder">${icon('image', 22)}<span>No photo</span></span>`;
    }
  };

  photoUrlInput?.addEventListener('input', () => updatePhotoPreview(photoUrlInput.value.trim()));

  photoFileInput?.addEventListener('change', async () => {
    const file = photoFileInput.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast('Please choose a valid image file (JPEG, PNG, WebP).', { type: 'error' });
      return;
    }
    photoPreview.innerHTML = `<span class="photo-placeholder">${icon('loader', 20)}<span>Uploading...</span></span>`;
    try {
      const dataUrl = await new Promise((resolve, reject) => {
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
            canvas.getContext('2d').drawImage(img, 0, 0, width, height);
            resolve(canvas.toDataURL('image/jpeg', 0.82));
          };
          img.src = reader.result;
        };
        reader.readAsDataURL(file);
      });
      const res = await api('/upload', { method: 'POST', body: { data: dataUrl } });
      if (res && res.url) {
        photoUrlInput.value = res.url;
        updatePhotoPreview(res.url);
        toast('Photo attached successfully.');
      } else {
        throw new Error('Upload response missing url');
      }
    } catch (err) {
      toast('Could not upload photo: ' + (err.message || 'Error'), { type: 'error' });
      updatePhotoPreview(photoUrlInput.value.trim());
    }
  });

  placeSelect.addEventListener('change', () => {
    const place = placeByName(placeSelect.value);
    if (!place) return;
    meetingInput.value = place.name;
    setPoint(place.lat, place.lng, place.name);
    map.panTo(place.lat, place.lng, 14);
  });

  const showError = (message) => {
    errorBox.hidden = false;
    errorBox.innerHTML = `${icon('info', 16)} <span>${esc(message)}</span>`;
  };

  modal.footer.querySelector('[data-close]').addEventListener('click', () => modal.close());
  const createButton = modal.footer.querySelector('[data-create]');
  createButton.addEventListener('click', async () => {
    errorBox.hidden = true;
    const values = formValues(form);
    const title = String(values.title || '').trim();
    const description = String(values.description || '').trim();
    const meeting = String(values.meeting_point || '').trim();
    if (title.length < 4) return showError('Give your tour a title of at least 4 characters.');
    if (description.length < 20) return showError('Describe the tour in at least 20 characters.');
    if (meeting.length < 3) return showError('Name the meeting point so guests can find you.');
    if (!values.starts_at) return showError('Choose a start date and time.');

    await withBusy(createButton, async () => {
      try {
        const tour = await api('/tours', {
          method: 'POST',
          body: {
            title,
            description,
            meeting_point: meeting,
            lat: point.lat,
            lng: point.lng,
            starts_at: new Date(values.starts_at).toISOString(),
            duration_min: Number(values.duration_min),
            capacity: Number(values.capacity),
            price: Number(values.price),
            theme: values.theme,
            image_url: values.image_url || '',
          },
        });
        modal.close();
        toast('Tour published. Share it with your group.');
        if (onCreated) onCreated(tour);
        ctx.navigate(`/tour/${tour.id}`);
      } catch (error) {
        showError(error.message);
      }
    });
  });

  const originalClose = modal.close;
  modal.close = () => {
    map.destroy();
    originalClose();
  };
}

/* ------------------------------------------------------------------ */
/* Shared helpers used by the detail page                              */
/* ------------------------------------------------------------------ */

export function tourFacts(tour) {
  return [
    { icon: 'calendar', label: 'Starts', value: dateTime(tour.starts_at), hint: tour.status === 'upcoming' ? countdown(tour.starts_at) : '' },
    { icon: 'clock', label: 'Length', value: minutes(tour.duration_min) },
    { icon: 'users', label: 'Group', value: `${tour.member_count} of ${tour.capacity}`, hint: tour.spots_left > 0 ? `${tour.spots_left} spots left` : 'Full' },
    { icon: 'wallet', label: 'Price', value: tour.price === 0 ? 'Free' : money(tour.price) },
    { icon: 'map-pin', label: 'Meet at', value: tour.meeting_point },
    { icon: 'compass', label: 'Theme', value: themeLabel(tour.theme) },
  ];
}

export { THEMES, THEME_COPY };
