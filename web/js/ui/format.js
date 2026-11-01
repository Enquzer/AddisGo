/* Formatting helpers shared across the app. */

export const ETHIOPIAN_MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function money(value, { suffix = false } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 'ETB 0';
  const rounded = Math.round(n);
  const text = rounded.toLocaleString('en-US');
  return suffix ? `${text} ETB` : `ETB ${text}`;
}

export function km(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return `${n < 10 ? n.toFixed(1) : Math.round(n)} km`;
}

export function minutes(value) {
  const n = Math.round(Number(value) || 0);
  if (n < 60) return `${n} min`;
  const h = Math.floor(n / 60);
  const m = n % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

function toDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function time(value) {
  const d = toDate(value);
  if (!d) return '—';
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export function date(value, { withYear = false } = {}) {
  const d = toDate(value);
  if (!d) return '—';
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(withYear ? { year: 'numeric' } : {}),
  });
}

export function dateTime(value) {
  const d = toDate(value);
  if (!d) return '—';
  return `${date(value)} · ${time(value)}`;
}

export function dayMonth(value) {
  const d = toDate(value);
  if (!d) return '—';
  return `${d.getDate()} ${ETHIOPIAN_MONTHS[d.getMonth()]}`;
}

export function relative(value) {
  const d = toDate(value);
  if (!d) return '—';
  const diff = d.getTime() - Date.now();
  const abs = Math.abs(diff);
  const past = diff < 0;
  const units = [
    [60_000, 'minute'],
    [3_600_000, 'hour'],
    [86_400_000, 'day'],
    [604_800_000, 'week'],
  ];
  if (abs < 60_000) return past ? 'just now' : 'in a moment';
  for (const [ms, name] of units) {
    if (abs < ms * (name === 'week' ? 4 : 60)) {
      const amount = Math.max(1, Math.round(abs / ms));
      return past ? `${amount} ${name}${amount > 1 ? 's' : ''} ago` : `in ${amount} ${name}${amount > 1 ? 's' : ''}`;
    }
  }
  return date(value);
}

export function countdown(value) {
  const d = toDate(value);
  if (!d) return '—';
  const diff = d.getTime() - Date.now();
  if (diff <= 0) return 'now';
  const mins = Math.round(diff / 60_000);
  if (mins < 60) return `in ${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `in ${hours} hr`;
  return `in ${Math.round(hours / 24)} days`;
}

export function initials(name) {
  const parts = String(name || '?').trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0] || '').join('').toUpperCase() || '?';
}

/** Only render avatar sources we control or that are explicitly safe. */
function safeAvatarUrl(value) {
  if (/^\/api\/uploads\/[a-f0-9]{32}\.(?:jpg|png|webp)$/i.test(value)) return value;
  if (/^assets\/[a-z0-9/_-]+\.(?:svg|png|jpe?g|webp)$/i.test(value)) return value;
  if (/^data:image\/(?:png|jpe?g|webp|gif);base64,[a-z0-9+/=]+$/i.test(value)) return value;
  if (/^blob:https?:\/\/[^\s]+$/i.test(value)) return value;
  if (/^https:\/\/[^\s]+$/i.test(value)) return value;
  return null;
}

export function getAvatarUrl(user) {
  const stored = String(user?.avatar_url || user?.photo_url || '').trim();
  if (stored) {
    const safe = safeAvatarUrl(stored);
    if (safe) return safe;
  }
  const name = String(user?.name || '').toLowerCase();
  if (name.includes('dawit')) return 'assets/drivers/dawit.svg';
  if (name.includes('lidya')) return 'assets/drivers/lidya.svg';
  if (name.includes('hanna')) return 'assets/drivers/hanna.svg';
  if (name.includes('yonas')) return 'assets/drivers/yonas.svg';
  if (user?.role === 'driver' || user?.make_model) return 'assets/drivers/default-driver.svg';
  return null;
}

export function avatar(user, size = 40, extraClass = '') {
  const color = /^#[0-9a-fA-F]{6}$/.test(user?.avatar_color || '') ? user.avatar_color : '#145c45';
  const badge = user?.is_verified
    ? '<span class="avatar-verified" title="Verified by AddisGo" aria-label="Verified">✓</span>'
    : '';
  const imgUrl = getAvatarUrl(user);
  if (imgUrl) {
    return `<span class="avatar avatar-has-img ${extraClass}" style="--avatar-size:${size}px;" aria-label="${esc(user?.name || 'User')}"><img src="${esc(imgUrl)}" alt="${esc(user?.name || '')}" class="avatar-img" width="${size}" height="${size}" loading="lazy" />${badge}</span>`;
  }
  return `<span class="avatar ${extraClass}" style="--avatar-size:${size}px;--avatar-color:${color}" aria-hidden="true">${esc(initials(user?.name))}${badge}</span>`;
}

export function stars(rating, { count = null, size = 14 } = {}) {
  const value = Math.max(0, Math.min(5, Number(rating) || 0));
  let out = '<span class="stars" aria-label="' + value.toFixed(1) + ' out of 5 stars">';
  for (let i = 1; i <= 5; i += 1) {
    out += `<svg class="star ${i <= Math.round(value) ? 'is-on' : ''}" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.6l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.4l-5.8 3.1 1.1-6.5L2.6 9.4l6.5-.9z" fill="currentColor"/></svg>`;
  }
  out += '</span>';
  if (value > 0) out += `<span class="stars-value">${value.toFixed(1)}</span>`;
  if (count !== null) out += `<span class="stars-count">(${count})</span>`;
  return `<span class="stars-wrap">${out}</span>`;
}

export const STATUS = {
  requested: { label: 'Finding a driver', tone: 'amber', step: 0 },
  accepted: { label: 'Driver on the way', tone: 'blue', step: 1 },
  arriving: { label: 'Arriving now', tone: 'violet', step: 2 },
  in_progress: { label: 'On the way', tone: 'green', step: 3 },
  completed: { label: 'Completed', tone: 'green', step: 4 },
  cancelled: { label: 'Cancelled', tone: 'red', step: -1 },
  pending: { label: 'In review', tone: 'amber' },
  approved: { label: 'Approved', tone: 'green' },
  suspended: { label: 'Suspended', tone: 'red' },
  active: { label: 'Active', tone: 'green' },
  upcoming: { label: 'Upcoming', tone: 'green' },
  open: { label: 'Open', tone: 'amber' },
  resolved: { label: 'Resolved', tone: 'green' },
  dismissed: { label: 'Dismissed', tone: 'muted' },
};

export function statusMeta(status) {
  return STATUS[status] || { label: String(status || '—').replace(/_/g, ' '), tone: 'muted' };
}

export function badge(label, tone = 'muted', extra = '') {
  return `<span class="badge badge-${esc(tone)} ${extra}">${esc(label)}</span>`;
}

export function statusBadge(status) {
  const meta = statusMeta(status);
  return badge(meta.label, meta.tone, 'badge-status');
}

export const VEHICLE_CLASSES = {
  e2: { name: 'Electric E2', short: 'E2', seats: 4, tone: 'green', blurb: 'Quiet electric city car' },
  comfort: { name: 'Comfort', short: 'Comfort', seats: 4, tone: 'blue', blurb: 'Extra room, smooth ride' },
  van: { name: 'Tour Van', short: 'Van', seats: 7, tone: 'amber', blurb: 'Groups and luggage' },
  bajaj: { name: 'Bajaj', short: 'Bajaj', seats: 3, tone: 'red', blurb: 'Quick neighbourhood hops' },
};

export function vehicleClass(key) {
  return VEHICLE_CLASSES[key] || { name: key || 'Ride', short: key || 'Ride', seats: 4, tone: 'muted', blurb: '' };
}

export function roleLabel(role) {
  return { customer: 'Rider', driver: 'Driver', admin: 'Admin' }[role] || role;
}

export function plural(count, word, pluralWord = `${word}s`) {
  return `${count} ${count === 1 ? word : pluralWord}`;
}

export function toLocalInput(dateObj) {
  const d = new Date(dateObj);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function defaultSchedule(hoursAhead = 3) {
  const d = new Date(Date.now() + hoursAhead * 3_600_000);
  d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0);
  return toLocalInput(d);
}

export function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}
