import { login, register, state } from '../store.js';
import { api, ApiError } from '../api.js';
import { icon, logoMark } from '../ui/icons.js';
import { esc, avatar } from '../ui/format.js';
import { toast, toastError } from '../ui/toast.js';
import { $, withBusy } from '../ui/dom.js';
import { navigate } from '../router.js';

const DEMO = [
  { label: 'Rider', email: 'meron@example.com', password: 'Rider123!', color: '#e86a4a' },
  { label: 'Driver', email: 'dawit@example.com', password: 'Driver123!', color: '#145c45' },
  { label: 'Admin', email: 'admin@addisgo.et', password: 'Admin123!', color: '#3b6ea5' },
];

export default async function renderAuth(view, ctx) {
  const isRegister = ctx.route.path === '/register' || ctx.path === '/register';
  const next = ctx.query.get('next') || '';
  document.title = `${isRegister ? 'Create account' : 'Sign in'} · AddisGo`;

  view.innerHTML = `
    <div class="auth-page">
      <section class="auth-card">
        <a class="auth-brand" href="#/">${logoMark(42)}<span><strong>AddisGo</strong><small>${isRegister ? 'Create your account' : 'Welcome back'}</small></span></a>
        <div class="auth-head">
          <p class="eyebrow">${isRegister ? 'Join the city' : 'Your Addis, waiting'}</p>
          <h1>${isRegister ? 'Start moving like a local.' : 'Sign in to AddisGo.'}</h1>
          <p>${isRegister ? 'One account for electric rides, small-group tours and your safety tools.' : 'Rides, tours and receipts — all in one place.'}</p>
        </div>

        <div class="form-alert" id="auth-error" role="alert" hidden></div>

        <form class="form auth-form" id="auth-form" novalidate>
          ${isRegister ? roleToggle() : ''}
          <div class="field-grid ${isRegister ? '' : 'is-single'}">
            ${isRegister ? `
              <label class="field">
                <span class="field-label">Full name</span>
                <input class="field-input" name="name" type="text" autocomplete="name" maxlength="60" placeholder="Meron Bekele" required />
              </label>
              <label class="field">
                <span class="field-label">Phone number</span>
                <input class="field-input" name="phone" type="tel" autocomplete="tel" maxlength="20" placeholder="+251 91 234 5678" required />
              </label>
            ` : ''}
            <label class="field ${isRegister ? 'field-wide' : ''}">
              <span class="field-label">Email address</span>
              <input class="field-input" name="email" type="email" autocomplete="email" maxlength="254" placeholder="you@example.com" required />
            </label>
            <label class="field ${isRegister ? '' : 'field-wide'}">
              <span class="field-label">Password</span>
              <span class="input-with-action">
                <input class="field-input" name="password" type="password" autocomplete="${isRegister ? 'new-password' : 'current-password'}" maxlength="128" placeholder="${isRegister ? 'At least 8 characters' : 'Your password'}" required />
                <button type="button" class="input-action" data-toggle-password aria-label="Show password">${icon('eye', 18)}</button>
              </span>
              ${isRegister ? '<span class="field-hint">Use 8+ characters with at least one letter and one number.</span>' : ''}
            </label>
            ${isRegister ? `
              <label class="field">
                <span class="field-label">Confirm password</span>
                <input class="field-input" name="confirm" type="password" autocomplete="new-password" maxlength="128" placeholder="Repeat your password" required />
              </label>
              <div class="field field-wide" id="vehicle-fields" hidden>
                <div class="field-set">
                  <p class="field-set-title">${icon('car', 16)} Vehicle details</p>
                  <div class="field-grid">
                    <label class="field">
                      <span class="field-label">Vehicle class</span>
                      <select class="field-input" name="vehicle_class">
                        <option value="e2">Electric E2</option>
                        <option value="comfort">Comfort</option>
                        <option value="van">Tour Van</option>
                        <option value="bajaj">Bajaj</option>
                      </select>
                    </label>
                    <label class="field">
                      <span class="field-label">Make &amp; model</span>
                      <input class="field-input" name="make_model" maxlength="60" placeholder="BYD Atto 3" />
                    </label>
                    <label class="field">
                      <span class="field-label">Plate number</span>
                      <input class="field-input" name="plate" maxlength="20" placeholder="AA 3 B 12345" />
                    </label>
                    <label class="field">
                      <span class="field-label">Colour</span>
                      <input class="field-input" name="color" maxlength="30" placeholder="Pearl white" />
                    </label>
                    <label class="field field-wide">
                      <span class="field-label">Driving licence number</span>
                      <input class="field-input" name="license_no" maxlength="30" placeholder="DL-1029384" />
                    </label>
                  </div>
                  <p class="field-hint">Our team reviews new driver applications before your first trip. Usually within one working day.</p>
                </div>
              </div>
            ` : ''}
          </div>

          ${isRegister ? `
            <label class="check-row">
              <input type="checkbox" name="terms" required />
              <span>I agree to the AddisGo community rules and safety guidelines.</span>
            </label>
          ` : `
            <div class="auth-row">
              <label class="check-row"><input type="checkbox" name="remember" checked /><span>Keep me signed in</span></label>
              <button type="button" class="text-btn" id="forgot">Forgot password?</button>
            </div>
          `}

          <button type="submit" class="btn btn-primary btn-lg btn-block" id="auth-submit">
            ${icon(isRegister ? 'sparkle' : 'arrow-right', 18)} ${isRegister ? 'Create my account' : 'Sign in'}
          </button>
        </form>

        <p class="auth-switch">
          ${isRegister ? 'Already have an account?' : 'New to AddisGo?'}
          <a href="${isRegister ? `#/login${next ? `?next=${encodeURIComponent(next)}` : ''}` : `#/register${next ? `?next=${encodeURIComponent(next)}` : ''}`}">
            ${isRegister ? 'Sign in' : 'Create an account'}
          </a>
        </p>

        ${!isRegister ? `
          <div class="demo-box">
            <p>${icon('key', 14)} Demo access <span>— instant sign-in for this build</span></p>
            <div class="demo-chips">
              ${DEMO.map((d) => `<button type="button" class="demo-chip" data-email="${esc(d.email)}" data-password="${esc(d.password)}" style="--chip:${d.color}">${esc(d.label)}</button>`).join('')}
            </div>
          </div>
        ` : ''}
      </section>

      <aside class="auth-aside">
        <div class="aside-top">
          <span class="aside-badge">${icon('shield', 14)} Safety-first city travel</span>
          <h2>“I stopped negotiating rides at the airport. Now I just open AddisGo.”</h2>
          <p class="aside-quote-by">${avatar({ name: 'Hanna T', avatar_color: '#b06ab3' }, 38)} <span><strong>Hanna T.</strong><small>Rider · Bole</small></span></p>
        </div>
        <div class="aside-list">
          <div>${icon('zap', 18)}<div><strong>Electric-first fleet</strong><p>Quiet, clean trips across the city.</p></div></div>
          <div>${icon('compass', 18)}<div><strong>Guides who live here</strong><p>Small groups, honest prices, real stories.</p></div></div>
          <div>${icon('shield', 18)}<div><strong>Private by default</strong><p>Your number is shared only with your driver.</p></div></div>
        </div>
        <div class="aside-foot">
          <span class="live-pill"><span class="live-dot"></span> ${state.user ? 'Signed in' : 'Live in Addis'}</span>
          <p>Addis Ababa · Ethiopia</p>
        </div>
      </aside>
    </div>
  `;

  const form = $('#auth-form', view);
  const errorBox = $('#auth-error', view);
  const submit = $('#auth-submit', view);
  const roleRadios = form.querySelectorAll('input[name="role"]');
  const vehicleFields = $('#vehicle-fields', view);

  const showError = (message) => {
    errorBox.hidden = false;
    errorBox.innerHTML = `${icon('info', 16)} <span>${esc(message)}</span>`;
    errorBox.classList.add('is-visible');
  };
  const clearError = () => {
    errorBox.hidden = true;
    errorBox.textContent = '';
  };

  form.querySelectorAll('input, select').forEach((input) => {
    input.addEventListener('input', () => {
      input.classList.remove('is-invalid');
      clearError();
    });
  });

  // Password visibility
  form.querySelectorAll('[data-toggle-password]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const input = btn.closest('.input-with-action')?.querySelector('input');
      if (!input) return;
      const showing = input.type === 'text';
      input.type = showing ? 'password' : 'text';
      btn.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
      btn.innerHTML = icon(showing ? 'eye' : 'lock', 18);
    });
  });

  const syncRole = () => {
    const role = form.querySelector('input[name="role"]:checked')?.value || 'customer';
    if (vehicleFields) vehicleFields.hidden = role !== 'driver';
    form.querySelectorAll('.role-option').forEach((el) => {
      el.classList.toggle('is-selected', el.querySelector('input')?.value === role);
    });
    const hint = form.querySelector('.role-explain');
    if (hint) {
      hint.textContent = role === 'driver'
        ? 'Earn on your schedule. Applications are reviewed before you can accept rides.'
        : 'Book rides, join tours and keep your trips in one place.';
    }
  };
  roleRadios.forEach((radio) => radio.addEventListener('change', syncRole));
  syncRole();

  // Demo autofill
  view.querySelectorAll('.demo-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const email = form.querySelector('[name="email"]');
      const password = form.querySelector('[name="password"]');
      if (email) email.value = chip.dataset.email || '';
      if (password) password.value = chip.dataset.password || '';
      clearError();
      toast(`${chip.textContent.trim()} demo filled in. Press sign in.`, { type: 'info' });
      submit?.focus();
    });
  });

  $('#forgot', view)?.addEventListener('click', () => {
    toast('Password resets are handled by support@addisgo.et in this build.', { type: 'info', duration: 6000 });
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearError();

    const values = Object.fromEntries(new FormData(form).entries());
    const email = String(values.email || '').trim();
    const password = String(values.password || '');

    if (!email || !password) {
      showError('Enter your email and password.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showError('That email address does not look right.');
      form.querySelector('[name="email"]')?.classList.add('is-invalid');
      return;
    }

    let payload = { email, password };
    if (isRegister) {
      const role = values.role || 'customer';
      if (!values.name?.trim() || values.name.trim().length < 2) {
        showError('Please enter your full name.');
        return;
      }
      const digits = String(values.phone || '').replace(/\D/g, '');
      if (digits.length < 7) {
        showError('Enter a phone number our drivers can reach you on.');
        return;
      }
      if (password.length < 8 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
        showError('Passwords need at least 8 characters, including a letter and a number.');
        return;
      }
      if (password !== values.confirm) {
        showError('Those passwords do not match.');
        form.querySelector('[name="confirm"]')?.classList.add('is-invalid');
        return;
      }
      if (!values.terms) {
        showError('Please agree to the community rules to continue.');
        return;
      }
      payload = {
        name: values.name.trim(),
        email,
        phone: String(values.phone).trim(),
        password,
        role,
      };
      if (role === 'driver') {
        if (!values.make_model?.trim() || !values.plate?.trim() || !values.license_no?.trim()) {
          showError('Add your vehicle details so our team can review your application.');
          return;
        }
        payload.vehicle = {
          vehicle_class: values.vehicle_class || 'e2',
          make_model: values.make_model.trim(),
          plate: values.plate.trim(),
          color: values.color?.trim() || '',
          license_no: values.license_no.trim(),
        };
      }
    }

    await withBusy(submit, async () => {
      try {
        const user = isRegister ? await register(payload) : await login(email, password);
        toast(isRegister
          ? (user.role === 'driver' ? 'Application received. We will review your vehicle details.' : `Welcome to AddisGo, ${user.name.split(' ')[0]}.`)
          : `Welcome back, ${user.name.split(' ')[0]}.`);
        const destination = next
          ? decodeURIComponent(next)
          : user.role === 'admin'
            ? '/admin'
            : user.role === 'driver'
              ? '/driver'
              : '/';
        navigate(destination, { replace: true });
      } catch (error) {
        if (error instanceof ApiError) showError(error.message);
        else showError('Could not reach AddisGo. Check your connection and try again.');
        console.error(error);
      }
    });
  });

  if (!isRegister) {
    const emailInput = form.querySelector('[name="email"]');
    if (emailInput) {
      window.setTimeout(() => emailInput.focus({ preventScroll: true }), 80);
    }
  }
}

function roleToggle() {
  return `<div class="role-toggle-wrap">
    <p class="field-label">I want to…</p>
    <div class="role-toggle" role="radiogroup" aria-label="Account type">
      <label class="role-option is-selected">
        <input type="radio" name="role" value="customer" checked />
        <span class="role-icon">${icon('user', 20)}</span>
        <span><strong>Ride &amp; explore</strong><small>Rider account</small></span>
      </label>
      <label class="role-option">
        <input type="radio" name="role" value="driver" />
        <span class="role-icon">${icon('car', 20)}</span>
        <span><strong>Drive with AddisGo</strong><small>Driver account</small></span>
      </label>
    </div>
    <p class="role-explain">Book rides, join tours and keep your trips in one place.</p>
  </div>`;
}
