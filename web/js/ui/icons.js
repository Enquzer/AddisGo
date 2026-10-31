/* Inline, dependency-free icon set (24×24, stroke). All paths are static and trusted. */

const PATHS = {
  'arrow-right': '<path d="M4 12h15"/><path d="M13 6l6 6-6 6"/>',
  'arrow-left': '<path d="M20 12H5"/><path d="M11 18l-6-6 6-6"/>',
  'arrow-up-right': '<path d="M7 17L17 7"/><path d="M8 7h9v9"/>',
  bell: '<path d="M18 8a6 6 0 10-12 0c0 7-3 8-3 8h18s-3-1-3-8"/><path d="M13.7 21a2 2 0 01-3.4 0"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1V9a1 1 0 011-1z"/><circle cx="12" cy="13.5" r="3.5"/>',
  car: '<path d="M5 17h14"/><path d="M4 17v-4l2-5a2 2 0 011.9-1.4h8.2A2 2 0 0118 8l2 5v4"/><path d="M4 13h16"/><circle cx="7.5" cy="17.5" r="1.5"/><circle cx="16.5" cy="17.5" r="1.5"/>',
  check: '<path d="M4.5 12.5l5 5L20 7"/>',
  'check-circle': '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.6 2.6L16.5 9"/>',
  'chevron-down': '<path d="M6 9l6 6 6-6"/>',
  'chevron-right': '<path d="M9 6l6 6-6 6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>',
  download: '<path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M4 20h16"/>',
  edit: '<path d="M4 20h4l10-10-4-4L4 16v4z"/><path d="M14 6l4 4"/>',
  eye: '<path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="2.6"/>',
  filter: '<path d="M3 5h18l-7 8v6l-4 2v-8z"/>',
  flag: '<path d="M5 21V4"/><path d="M5 4h11l-1.5 4L16 12H5"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c2.6 2.4 4 5.6 4 9s-1.4 6.6-4 9c-2.6-2.4-4-5.6-4-9s1.4-6.6 4-9z"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  heart: '<path d="M12 20s-7-4.3-7-9.4A4 4 0 0112 7a4 4 0 017 3.6C19 15.7 12 20 12 20z"/>',
  home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M9.5 20v-6h5v6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8h.01"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l8-8"/><path d="M16 7l2 2"/><path d="M14 9l2 2"/>',
  leaf: '<path d="M20 4C10 4 5 8 5 14a5 5 0 005 5c6 0 10-5 10-15z"/><path d="M4 21c2-5 6-8 11-9"/>',
  lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 018 0v3"/>',
  'log-out': '<path d="M15 4h4a1 1 0 011 1v14a1 1 0 01-1 1h-4"/><path d="M10 8l-4 4 4 4"/><path d="M6 12h10"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3.5 6.5L12 13l8.5-6.5"/>',
  map: '<path d="M3 6.5l6-2 6 2 6-2v13l-6 2-6-2-6 2z"/><path d="M9 4.5v13M15 6.5v13"/>',
  'map-pin': '<path d="M12 21s7-5.3 7-11a7 7 0 10-14 0c0 5.7 7 11 7 11z"/><circle cx="12" cy="10" r="2.6"/>',
  menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
  message: '<path d="M21 12a8.5 8.5 0 01-12.3 7.6L4 21l1.5-4.6A8.5 8.5 0 1121 12z"/><path d="M8.5 11.5h.01M12 11.5h.01M15.5 11.5h.01"/>',
  minus: '<path d="M5 12h14"/>',
  navigation: '<path d="M21 3L3 10.5l7.5 2.5L13 21z"/>',
  phone: '<path d="M6.5 3h3l1.5 4-2 1.5a12 12 0 005.5 5.5L16 12l4 1.5v3a2 2 0 01-2.2 2A16 16 0 014.5 5.2 2 2 0 016.5 3z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  power: '<path d="M12 3v9"/><path d="M7 6.5a8 8 0 1010 0"/>',
  qr: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM19 14h2M14 19h2v2M19 19h2v2"/>',
  refresh: '<path d="M20 11a8 8 0 10-2 6"/><path d="M20 5v6h-6"/>',
  route: '<circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="6" r="2.5"/><path d="M8.5 18H14a4 4 0 000-8H9a3 3 0 010-6h6.5"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l5 5"/>',
  send: '<path d="M21 3L10.5 13.5"/><path d="M21 3l-6.5 18-4-8-8-4z"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.9l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.9-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.9.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.9 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.9l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.9.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.9-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.9V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
  smartphone: '<rect x="6" y="2" width="12" height="20" rx="2.5"/><path d="M10.5 18.5h3"/>',
  sparkle: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  landmark: '<path d="M3 21h18M5 21V10M9 21V10M15 21V10M19 21V10M3 10h18L12 3z"/>',
  'volume-2': '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/>',
  star: '<path d="M12 3.2l2.7 5.5 6 .9-4.3 4.2 1 6-5.4-2.9-5.4 2.9 1-6L3.3 9.6l6-.9z"/>',
  ticket: '<path d="M3 8a2 2 0 012-2h14a2 2 0 012 2v2a2 2 0 000 4v2a2 2 0 01-2 2H5a2 2 0 01-2-2v-2a2 2 0 000-4z"/><path d="M13 6v12"/>',
  'trending-up': '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
  trash: '<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 14h10l1-14"/><path d="M10 11v6M14 11v6"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.5 3-5.5 6.5-5.5s6.5 2 6.5 5.5"/><path d="M16 4.8a3.5 3.5 0 010 6.4"/><path d="M18 14.6c2.2.5 3.5 2.1 3.5 4.4"/>',
  wallet: '<rect x="3" y="6" width="18" height="14" rx="2.5"/><path d="M3 10h18"/><path d="M16 15h2"/>',
  zap: '<path d="M13 2L4 14h6l-1 8 9-12h-6z"/>',
  ban: '<circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/>',
  award: '<circle cx="12" cy="9" r="5.5"/><path d="M8.2 13.5L7 22l5-2.6L17 22l-1.2-8.5"/>',
  'external-link': '<path d="M14 4h6v6"/><path d="M20 4l-8 8"/><path d="M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5"/>',
};

export function icon(name, size = 20, cls = '') {
  const path = PATHS[name] || PATHS.info;
  return `<svg class="icon ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${path}</svg>`;
}

export function logoMark(size = 36) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 48 48" role="img" aria-label="AddisGo">
    <rect width="48" height="48" rx="14" fill="#0d3b2e"/>
    <path d="M13 35L24 11l11 24" stroke="#f4b860" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
    <path d="M18.5 28h11" stroke="#fbf7ef" stroke-width="3" stroke-linecap="round"/>
    <circle cx="35.5" cy="13" r="3" fill="#e86a4a"/>
  </svg>`;
}
