import { api, newIdempotencyKey } from '../api.js';
import { state, refreshMe, logout } from '../store.js';
import { icon } from '../ui/icons.js';
import {
  esc, date, relative, avatar, initials, roleLabel, statusBadge, vehicleClass, money, plural,
} from '../ui/format.js';
import { pageHead, sectionHead, emptyState, skeletons } from '../ui/layout.js';
import { openModal, promptModal, confirmModal } from '../ui/modal.js';
import { toast, toastError } from '../ui/toast.js';
import { $, withBusy } from '../ui/dom.js';

const TABS = [
  { key: 'profile', label: 'Profile', icon: 'user' },
  { key: 'security', label: 'Password', icon: 'key' },
  { key: 'safety', label: 'Safety centre', icon: 'shield' },
];

const LANGUAGES = [
  'English', 'Amharic', 'Afaan Oromo', 'Tigrinya', 'Somali', 'Arabic',
  'French', 'Italian', 'Spanish', 'German', 'Chinese', 'Swahili',
];

const COLOURS = ['#145c45', '#0d3b2e', '#3b6ea5', '#e86a4a', '#b0563f', '#7a4f9e', '#b6802f', '#2f7d78'];

const AVATAR_MAX_INPUT_BYTES = 12 * 1024 * 1024;
const AVATAR_EDGE = 512;

function loadImageElement(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('That image could not be read. Please try another photo.'));
    };
    image.src = url;
  });
}

async function readAvatarFile(file) {
  if (!/^image\/(jpeg|png|webp)$/i.test(file.type)) {
    throw new Error('Choose a JPG, PNG or WebP photo. SVG files are not accepted.');
  }
  if (file.size > AVATAR_MAX_INPUT_BYTES) {
    throw new Error('That photo is larger than 12 MB. Please choose a smaller one.');
  }
  if (typeof window.createImageBitmap === 'function') {
    try {
      return await window.createImageBitmap(file);
    } catch {
      return loadImageElement(file);
    }
  }
  return loadImageElement(file);
}

/** Centre-crop and downscale in the browser so only a small image is uploaded. */
async function downscaleAvatar(file) {
  const image = await readAvatarFile(file);
  const width = Number(image.width);
  const height = Number(image.height);
  if (!width || !height) throw new Error('That image could not be read. Please try another photo.');
  const side = Math.min(width, height);
  const target = Math.max(1, Math.min(AVATAR_EDGE, side));
  const canvas = document.createElement('canvas');
  canvas.width = target;
  canvas.height = target;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Your browser could not resize that photo.');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  // A white matte keeps transparent PNGs from turning black in JPEG fallbacks.
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, target, target);
  context.drawImage(image, (width - side) / 2, (height - side) / 2, side, side, 0, 0, target, target);
  if (typeof image.close === 'function') image.close();
  const data = canvas.toDataURL('image/webp', 0.86);
  if (!/^data:image\/(?:webp|png|jpeg);base64,/i.test(data)) {
    throw new Error('Your browser could not prepare that photo.');
  }
  return data;
}

export default async function renderProfile(view, ctx) {
  let tab = ctx.query.get('tab') || 'profile';
  if (!TABS.some((t) => t.key === tab)) tab = 'profile';
  let user = state.user;

  view.innerHTML = `
    <section class="profile-page">
      ${pageHead({
        eyebrow: 'Your account',
        title: 'Profile & safety.',
        description: 'Keep your details accurate, protect your sign-in, and find help when you need it.',
      })}

      <div class="profile-hero panel">
        <div class="profile-avatar-block">
          <div class="profile-avatar-wrap">
            <span id="profile-avatar">${avatar(user, 76)}</span>
            <span class="profile-status ${user.status === 'active' ? 'is-active' : ''}">${esc(user.status === 'active' ? 'Active' : user.status)}</span>
          </div>
          <div class="profile-avatar-tools">
            <button type="button" class="btn btn-sm btn-ghost" id="avatar-upload">${icon('camera', 14)} Change photo</button>
            <button type="button" class="btn btn-sm btn-ghost btn-danger-text" id="avatar-remove" ${user.avatar_url ? '' : 'hidden'}>${icon('trash', 14)} Remove</button>
          </div>
          <input type="file" id="avatar-file" accept="image/jpeg,image/png,image/webp" hidden />
          <p class="profile-avatar-hint">JPG, PNG or WebP · resized automatically</p>
        </div>
        <div class="profile-hero-copy">
          <h2 id="profile-hero-name">${esc(user.name)}</h2>
          <p>${esc(user.email)} · ${esc(roleLabel(user.role))}${user.driver ? ` · ${esc(vehicleClass(user.driver.vehicle_class).name)}` : ''}</p>
          <div class="profile-hero-badges">
            ${user.is_verified ? `<span class="badge badge-green">${icon('check-circle', 13)} Verified</span>` : `<span class="badge badge-muted">${icon('clock', 13)} Not verified yet</span>`}
            <span class="badge badge-soft">${icon('calendar', 13)} Joined ${esc(date(user.created_at, { withYear: true }))}</span>
            ${user.driver ? statusBadge(user.driver.status) : ''}
          </div>
        </div>
        <div class="profile-hero-actions">
          ${user.role === 'driver' ? `<a class="btn btn-sm btn-ghost" href="#/driver">${icon('car', 15)} Driver dashboard</a>` : ''}
          ${user.role === 'admin' ? `<a class="btn btn-sm btn-ghost" href="#/admin">${icon('grid', 15)} Operations CRM</a>` : ''}
          <a class="btn btn-sm btn-ghost" href="#/trips">${icon('route', 15)} My trips</a>
        </div>
      </div>

      <section class="panel profile-shell">
        <div class="tabs" role="tablist" aria-label="Profile sections">
          ${TABS.map((t) => `
            <button type="button" class="tab ${t.key === tab ? 'is-active' : ''}" role="tab"
              data-tab="${t.key}" aria-selected="${t.key === tab}" aria-controls="profile-panel-${t.key}">
              ${icon(t.icon, 15)} ${esc(t.label)}
            </button>
          `).join('')}
        </div>

        <div class="tab-panels">
          <section class="tab-panel" data-panel="profile" id="profile-panel-profile" role="tabpanel" ${tab === 'profile' ? '' : 'hidden'}>
            <div class="profile-grid">
              <div class="profile-main">
                <form class="form" id="profile-form" novalidate>
                  <div class="form-alert" id="profile-error" role="alert" hidden></div>

                  <div class="field-grid">
                    <label class="field field-wide">
                      <span class="field-label">Full name</span>
                      <input class="field-input" name="name" maxlength="60" value="${esc(user.name)}" autocomplete="name" required />
                    </label>
                    <label class="field">
                      <span class="field-label">Phone number</span>
                      <input class="field-input" name="phone" maxlength="30" value="${esc(user.phone || '')}" autocomplete="tel" inputmode="tel" required />
                      <span class="field-hint">Only shared with a driver after you book.</span>
                    </label>
                    <label class="field">
                      <span class="field-label">Email</span>
                      <input class="field-input" value="${esc(user.email)}" readonly disabled />
                      <span class="field-hint">Contact support to change your email.</span>
                    </label>
                    <label class="field field-wide">
                      <span class="field-label">About you <em>(optional)</em></span>
                      <textarea class="field-input" name="bio" rows="4" maxlength="400" placeholder="A line about you helps drivers and hosts welcome you.">${esc(user.bio || '')}</textarea>
                      <span class="field-hint">Up to 400 characters. Shown on your tour profile.</span>
                    </label>
                  </div>

                  <fieldset class="field colour-field">
                    <legend class="field-label">Avatar colour</legend>
                    <div class="colour-swatches" role="radiogroup" aria-label="Avatar colour">
                      ${COLOURS.map((colour) => `
                        <label class="colour-swatch" style="--swatch:${colour}" title="${colour}">
                          <input type="radio" name="avatar_color" value="${colour}" ${sameColor(user.avatar_color, colour) ? 'checked' : ''} />
                          <span class="colour-dot" aria-hidden="true">${sameColor(user.avatar_color, colour) ? icon('check', 15) : ''}</span>
                          <span class="sr-only">${colour}</span>
                        </label>
                      `).join('')}
                    </div>
                  </fieldset>

                  <fieldset class="field languages-field">
                    <legend class="field-label">Languages you speak</legend>
                    <p class="field-hint">Choose up to six. Hosts and riders use this to break the ice.</p>
                    <div class="language-chips" role="group" aria-label="Languages">
                      ${LANGUAGES.map((language) => `
                        <label class="check-chip">
                          <input type="checkbox" name="languages" value="${esc(language)}" ${(user.languages || []).includes(language) ? 'checked' : ''} />
                          <span>${esc(language)}</span>
                        </label>
                      `).join('')}
                    </div>
                    <p class="field-hint" id="language-count">${(user.languages || []).length} of 6 selected</p>
                  </fieldset>

                  <div class="form-actions">
                    <button type="submit" class="btn btn-primary" id="profile-save">${icon('check', 16)} Save profile</button>
                    <span class="muted">Changes are visible immediately.</span>
                  </div>
                </form>
              </div>

              <aside class="profile-side">
                <section class="panel account-card">
                  <h2 class="panel-title">Account</h2>
                  <dl class="account-list">
                    <div><dt>Role</dt><dd>${esc(roleLabel(user.role))}</dd></div>
                    <div><dt>Status</dt><dd>${statusBadge(user.status)}</dd></div>
                    <div><dt>Member since</dt><dd>${esc(date(user.created_at, { withYear: true }))}</dd></div>
                    ${user.driver ? `
                      <div><dt>Vehicle</dt><dd>${esc(user.driver.make_model)}</dd></div>
                      <div><dt>Plate</dt><dd class="plate">${esc(user.driver.plate)}</dd></div>
                      <div><dt>Rating</dt><dd>${esc(Number(user.driver.rating || 5).toFixed(1))} / 5</dd></div>
                    ` : ''}
                  </dl>
                  ${user.role === 'customer' ? `<a class="text-link" href="#/register">Want to drive with AddisGo? ${icon('arrow-right', 14)}</a>` : ''}
                  ${user.role === 'driver' ? `<a class="text-link" href="#/driver?tab=vehicle">Update vehicle details ${icon('arrow-right', 14)}</a>` : ''}
                </section>

                <section class="panel">
                  ${sectionHead('Session')}
                  <p class="muted">Signed in as ${esc(user.email)}. Signing out clears this device only.</p>
                  <button type="button" class="btn btn-ghost btn-block btn-danger-text" id="sign-out">${icon('log-out', 16)} Sign out</button>
                </section>
              </aside>
            </div>
          </section>

          <section class="tab-panel" data-panel="security" id="profile-panel-security" role="tabpanel" ${tab === 'security' ? '' : 'hidden'}>
            <div class="security-grid">
              <form class="form" id="password-form" novalidate>
                <div class="panel-head-row">
                  <div><h2>Change your password</h2><p>Use at least 8 characters with a letter and a number.</p></div>
                  ${icon('key', 24)}
                </div>
                <div class="form-alert" id="password-error" role="alert" hidden></div>
                <label class="field">
                  <span class="field-label">Current password</span>
                  <input class="field-input" type="password" name="current_password" autocomplete="current-password" required />
                </label>
                <label class="field">
                  <span class="field-label">New password</span>
                  <input class="field-input" type="password" name="new_password" autocomplete="new-password" minlength="8" maxlength="128" required />
                  <span class="field-hint">8–128 characters, with at least one letter and one number.</span>
                </label>
                <label class="field">
                  <span class="field-label">Confirm new password</span>
                  <input class="field-input" type="password" name="confirm_password" autocomplete="new-password" minlength="8" maxlength="128" required />
                </label>
                <div class="form-actions">
                  <button type="submit" class="btn btn-primary" id="password-save">${icon('lock', 16)} Update password</button>
                </div>
              </form>

              <aside class="security-side">
                <section class="panel">
                  <h2 class="panel-title">Sign-in security</h2>
                  <ul class="check-list">
                    <li>${icon('check', 14)} Passwords are stored as salted scrypt hashes.</li>
                    <li>${icon('check', 14)} Sessions last seven days in a secure cookie.</li>
                    <li>${icon('check', 14)} Password changes are rate limited and audited.</li>
                    <li>${icon('check', 14)} Signing out clears your session on this device.</li>
                  </ul>
                </section>
                <section class="panel trust-panel">
                  <span class="trust-icon">${icon('shield', 20)}</span>
                  <div>
                    <strong>Use a unique password</strong>
                    <p>Do not reuse your email or bank password. If you think someone has access to your account, change your password and contact support@addisgo.et.</p>
                  </div>
                </section>
              </aside>
            </div>
          </section>

          <section class="tab-panel" data-panel="safety" id="profile-panel-safety" role="tabpanel" ${tab === 'safety' ? '' : 'hidden'}>
            <div class="safety-grid">
              <div class="safety-main">
                <section class="panel">
                  <div class="panel-head-row">
                    <div>
                      <h2>Report something</h2>
                      <p>Choose a recent trip or tour. Reports go straight to our safety desk and are rate limited.</p>
                    </div>
                    ${icon('flag', 22)}
                  </div>
                  <div id="report-targets">${skeletons(2, 'line-skeleton')}</div>
                </section>

                <section class="panel">
                  <h2 class="panel-title">How AddisGo keeps you safe</h2>
                  <div class="safety-cards">
                    <div class="safety-card">
                      <span>${icon('shield', 20)}</span>
                      <strong>Reviewed drivers</strong>
                      <p>Every driver application is checked by our operations team before approval.</p>
                    </div>
                    <div class="safety-card">
                      <span>${icon('lock', 20)}</span>
                      <strong>Private contact details</strong>
                      <p>Phone numbers unlock only when a driver accepts your ride, and stay inside the trip.</p>
                    </div>
                    <div class="safety-card">
                      <span>${icon('qr', 20)}</span>
                      <strong>Check-in passes</strong>
                      <p>Your QR pass proves the right rider is in the right car at pickup.</p>
                    </div>
                    <div class="safety-card">
                      <span>${icon('message', 20)}</span>
                      <strong>In-app chat</strong>
                      <p>Coordinate without sharing your personal number. Members-only tour chats.</p>
                    </div>
                  </div>
                </section>
              </div>

              <aside class="safety-side">
                <section class="panel emergency-card">
                  <span class="emergency-icon">${icon('phone', 22)}</span>
                  <h2>In an emergency</h2>
                  <p>If you are in immediate danger, call the police first, then let us know.</p>
                  <a class="btn btn-danger btn-block" href="tel:991">${icon('phone', 16)} Call 991 (police)</a>
                  <a class="btn btn-ghost btn-block" href="mailto:safety@addisgo.et?subject=${encodeURIComponent('Urgent safety report')}">${icon('mail', 16)} Email the safety desk</a>
                </section>
                <section class="panel">
                  <h2 class="panel-title">Support</h2>
                  <ul class="link-list">
                    <li><a href="mailto:support@addisgo.et">${icon('mail', 15)} support@addisgo.et</a></li>
                    <li><a href="#/trips">${icon('route', 15)} Review your trips</a></li>
                    <li><a href="#/tours">${icon('compass', 15)} Browse city tours</a></li>
                  </ul>
                  <p class="fine-print">Include a trip code, tour name or account email so we can find the right record quickly.</p>
                </section>
              </aside>
            </div>
          </section>
        </div>
      </section>
    </section>
  `;

  /* ---------------------------------------------------------------- */
  /* Tabs                                                              */
  /* ---------------------------------------------------------------- */

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
      window.history.replaceState(null, '', `#/profile${next === 'profile' ? '' : `?tab=${next}`}`);
    }
    if (next === 'safety' && !targetsLoaded) void loadTargets();
  };

  view.querySelectorAll('[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => showTab(btn.dataset.tab));
  });

  /* ---------------------------------------------------------------- */
  /* Profile form                                                      */
  /* ---------------------------------------------------------------- */

  const form = $('#profile-form', view);
  const errorBox = $('#profile-error', view);
  const nameInput = form.querySelector('[name="name"]');
  const languageBox = $('#language-count', view);

  const syncLanguageCount = () => {
    const selected = form.querySelectorAll('[name="languages"]:checked');
    if (languageBox) languageBox.textContent = `${selected.length} of 6 selected`;
    form.querySelectorAll('[name="languages"]').forEach((input) => {
      input.disabled = !input.checked && selected.length >= 6;
    });
  };
  form.querySelectorAll('[name="languages"]').forEach((input) => {
    input.addEventListener('change', syncLanguageCount);
  });
  syncLanguageCount();

  const paintAvatarPreview = () => {
    const chosen = form.querySelector('[name="avatar_color"]:checked')?.value || user.avatar_color;
    const host = $('#profile-avatar', view);
    if (host) {
      host.innerHTML = avatar({
        name: nameInput.value.trim() || user.name,
        avatar_color: chosen,
        avatar_url: user.avatar_url,
        is_verified: user.is_verified,
      }, 76);
    }
    const heroName = $('#profile-hero-name', view);
    if (heroName) heroName.textContent = nameInput.value.trim() || user.name;
    form.querySelectorAll('.colour-swatch').forEach((label) => {
      const input = label.querySelector('input');
      label.classList.toggle('is-selected', input.checked);
      const dot = label.querySelector('.colour-dot');
      if (dot) dot.innerHTML = input.checked ? icon('check', 15) : '';
    });
  };

  nameInput.addEventListener('input', paintAvatarPreview);
  form.querySelectorAll('[name="avatar_color"]').forEach((input) => {
    input.addEventListener('change', paintAvatarPreview);
  });
  paintAvatarPreview();

  const avatarInput = $('#avatar-file', view);
  const avatarButton = $('#avatar-upload', view);
  const avatarRemove = $('#avatar-remove', view);

  const applyAvatarResult = async (avatarUrl) => {
    try {
      user = await refreshMe();
    } catch {
      user = { ...user, avatar_url: avatarUrl };
      state.user = user;
    }
    paintAvatarPreview();
    if (avatarRemove) avatarRemove.hidden = !user.avatar_url;
  };

  avatarButton?.addEventListener('click', () => avatarInput?.click());

  avatarInput?.addEventListener('change', async () => {
    const file = avatarInput.files?.[0];
    avatarInput.value = '';
    if (!file) return;
    await withBusy(avatarButton, async () => {
      try {
        const data = await downscaleAvatar(file);
        const result = await api('/profile/avatar', { method: 'POST', body: { data }, timeout: 30_000 });
        await applyAvatarResult(result.avatar_url);
        toast('Profile photo updated.');
      } catch (error) {
        toastError(error, 'That photo could not be uploaded.');
      }
    });
  });

  avatarRemove?.addEventListener('click', async () => {
    const confirmed = await confirmModal({
      title: 'Remove your profile photo?',
      message: 'Your initials and avatar colour will show instead. You can upload a new photo at any time.',
      confirmLabel: 'Remove photo',
      danger: true,
    });
    if (!confirmed) return;
    await withBusy(avatarRemove, async () => {
      try {
        await api('/profile/avatar', { method: 'DELETE' });
        await applyAvatarResult('');
        toast('Profile photo removed.');
      } catch (error) {
        toastError(error);
      }
    });
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    errorBox.hidden = true;
    const values = new FormData(form);
    const languages = values.getAll('languages').map(String);
    const payload = {
      name: String(values.get('name') || '').trim(),
      phone: String(values.get('phone') || '').trim(),
      bio: String(values.get('bio') || '').trim(),
      languages,
      avatar_color: String(values.get('avatar_color') || user.avatar_color),
    };
    if (payload.name.length < 2) {
      showFormError(errorBox, 'Please enter your full name (at least 2 characters).');
      nameInput.focus();
      return;
    }
    if (!payload.phone) {
      showFormError(errorBox, 'Please add a phone number so drivers can reach you.');
      form.querySelector('[name="phone"]').focus();
      return;
    }
    if (languages.length > 6) {
      showFormError(errorBox, 'Choose up to six languages.');
      return;
    }

    const button = $('#profile-save', view);
    await withBusy(button, async () => {
      try {
        await api('/profile', { method: 'PATCH', body: payload });
        toast('Profile saved.');
        try { await refreshMe(); } catch { /* saved locally by the server response */ }
      } catch (error) {
        showFormError(errorBox, error.message);
      }
    });
  });

  /* ---------------------------------------------------------------- */
  /* Password                                                          */
  /* ---------------------------------------------------------------- */

  const passwordForm = $('#password-form', view);
  const passwordError = $('#password-error', view);
  passwordForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    passwordError.hidden = true;
    const data = new FormData(passwordForm);
    const current = String(data.get('current_password') || '');
    const next = String(data.get('new_password') || '');
    const confirm = String(data.get('confirm_password') || '');
    if (!current) {
      showFormError(passwordError, 'Enter your current password.');
      return;
    }
    if (next.length < 8 || !/[A-Za-z]/.test(next) || !/[0-9]/.test(next)) {
      showFormError(passwordError, 'New password must be 8+ characters with at least one letter and one number.');
      return;
    }
    if (next !== confirm) {
      showFormError(passwordError, 'The new passwords do not match.');
      return;
    }
    if (next === current) {
      showFormError(passwordError, 'Choose a new password that is different from the current one.');
      return;
    }

    const button = $('#password-save', view);
    await withBusy(button, async () => {
      try {
        await api('/profile/password', {
          method: 'POST',
          body: { current_password: current, new_password: next },
        });
        passwordForm.reset();
        toast('Password updated. Keep it somewhere safe.');
      } catch (error) {
        showFormError(passwordError, error.message);
      }
    });
  });

  /* ---------------------------------------------------------------- */
  /* Safety targets                                                    */
  /* ---------------------------------------------------------------- */

  let targetsLoaded = false;

  async function loadTargets() {
    const host = $('#report-targets', view);
    if (!host) return;
    targetsLoaded = true;
    host.innerHTML = skeletons(2, 'line-skeleton');
    try {
      const [bookingsResult, toursResult] = await Promise.allSettled([
        api('/bookings?scope=recent'),
        api('/tours?mine=1'),
      ]);
      const bookings = bookingsResult.status === 'fulfilled' ? bookingsResult.value.bookings || [] : [];
      const tours = toursResult.status === 'fulfilled' ? (toursResult.value.tours || []).filter((t) => !t.is_host) : [];
      if (!bookings.length && !tours.length) {
        host.innerHTML = emptyState({
          icon: 'flag',
          title: 'Nothing to report yet',
          text: 'After a trip or tour, you can flag an issue here. In an emergency call 991 first.',
          action: '<a class="btn btn-sm btn-ghost" href="mailto:safety@addisgo.et">Email the safety desk</a>',
        });
        return;
      }
      host.innerHTML = `
        ${bookings.length ? `
          <h3 class="target-group-title">Recent trips</h3>
          <ul class="target-list">
            ${bookings.slice(0, 5).map((booking) => `
              <li>
                <span class="target-icon">${icon('car', 16)}</span>
                <span class="target-copy">
                  <strong>${esc(booking.pickup)} → ${esc(booking.dropoff)}</strong>
                  <small>${esc(booking.code)} · ${esc(date(booking.created_at))} · ${esc(money(booking.fare))}</small>
                </span>
                <button type="button" class="btn btn-xs btn-ghost btn-danger-text"
                  data-report-type="booking" data-report-id="${booking.id}"
                  data-report-label="trip ${esc(booking.code)}">${icon('flag', 13)} Report</button>
              </li>
            `).join('')}
          </ul>
        ` : ''}
        ${tours.length ? `
          <h3 class="target-group-title">Tours you joined</h3>
          <ul class="target-list">
            ${tours.slice(0, 5).map((tour) => `
              <li>
                <span class="target-icon">${icon('compass', 16)}</span>
                <span class="target-copy">
                  <strong>${esc(tour.title)}</strong>
                  <small>${esc(date(tour.starts_at))} · ${esc(tour.meeting_point)}</small>
                </span>
                <button type="button" class="btn btn-xs btn-ghost btn-danger-text"
                  data-report-type="tour" data-report-id="${tour.id}"
                  data-report-label="tour ${esc(tour.title)}">${icon('flag', 13)} Report</button>
              </li>
            `).join('')}
          </ul>
        ` : ''}
      `;
    } catch (error) {
      host.innerHTML = `<div class="inline-error">${icon('info', 18)} ${esc(error.message)}</div>`;
    }
  }

  const onViewClick = async (event) => {
    const reportBtn = event.target.closest('[data-report-type]');
    if (reportBtn) {
      const type = reportBtn.dataset.reportType;
      const label = reportBtn.dataset.reportLabel || 'this record';
      const reason = await promptModal({
        title: 'Report a safety issue',
        eyebrow: label,
        label: 'What happened?',
        placeholder: 'Unsafe driving, harassment, misleading details…',
        confirmLabel: 'Send to safety desk',
        multiline: true,
        maxLength: 200,
        hint: '3–200 characters. Our team reads every report.',
      });
      if (!reason) return;
      await withBusy(reportBtn, async () => {
        try {
          await api('/reports', {
            method: 'POST',
            idempotencyKey: newIdempotencyKey(),
            body: {
              target_type: type,
              target_id: Number(reportBtn.dataset.reportId),
              reason,
              detail: `Reported from profile safety centre — ${label}`,
            },
          });
          toast('Report sent. Our safety desk will review it.');
        } catch (error) {
          toastError(error);
        }
      });
      return;
    }

    if (event.target.closest('#sign-out')) {
      const ok = await confirmModal({
        title: 'Sign out of AddisGo?',
        message: 'You will need your email and password to sign back in on this device.',
        confirmLabel: 'Sign out',
        cancelLabel: 'Stay signed in',
      });
      if (!ok) return;
      try {
        await logout();
        toast('Signed out. See you soon.');
        ctx.navigate('/');
      } catch (error) {
        toastError(error, 'Could not sign out.');
      }
    }
  };

  view.addEventListener('click', onViewClick);

  if (tab === 'safety') void loadTargets();

  return () => {
    view.removeEventListener('click', onViewClick);
  };
}

function sameColor(a, b) {
  return String(a || '').toLowerCase() === String(b || '').toLowerCase();
}

function showFormError(box, message) {
  if (!box) return;
  box.hidden = false;
  box.innerHTML = `${icon('info', 16)} <span>${esc(message)}</span>`;
}
