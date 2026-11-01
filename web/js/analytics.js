/*
 * Privacy-safe website analytics beacon.
 *
 * Only the normalised path, the referrer host and an event name are sent.
 * No cookies, no user ids, no query strings. The server stores aggregate
 * counters (day · path · referrer · event → count) and nothing else.
 */

const ENDPOINT = '/api/public/analytics';
let referrerSent = false;

function normalisePath(path) {
  const raw = String(path || '/').split('?')[0].split('#')[0] || '/';
  return raw.replace(/\/\d+(?=\/|$)/g, '/:id');
}

function send(payload) {
  try {
    const body = JSON.stringify(payload);
    if (navigator.sendBeacon) {
      const blob = new Blob([body], { type: 'application/json' });
      if (navigator.sendBeacon(ENDPOINT, blob)) return;
    }
    fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
      credentials: 'omit',
    }).catch(() => {});
  } catch {
    /* analytics must never break the app */
  }
}

/** Records one page view. Call after a route renders successfully. */
export function trackPageview(path) {
  const referrer = referrerSent ? '' : document.referrer;
  referrerSent = true;
  send({ path: normalisePath(path), referrer, event: 'pageview' });
}

/** Records a named public action, e.g. tour_view, share, newsletter. */
export function trackEvent(event, path = window.location.hash.replace(/^#/, '') || '/') {
  send({ path: normalisePath(path), referrer: '', event });
}
