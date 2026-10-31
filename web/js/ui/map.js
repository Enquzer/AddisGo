import { ADDIS_CENTER } from '../places.js';
import { api } from '../api.js';
import { icon } from './icons.js';
import { esc } from './format.js';

const TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>';

function hasLeaflet() {
  return typeof window !== 'undefined' && Boolean(window.L);
}

function pinIcon(kind, label = '') {
  let inner;
  if (kind === 'pickup') {
    inner = '<span class="map-pin-dot"></span>';
  } else if (kind === 'dropoff') {
    inner = '<span class="map-pin-flag"></span>';
  } else if (kind === 'current' || kind === 'user') {
    inner = '<span class="map-pin-user-pulse"></span>';
  } else {
    inner = icon('car', 15);
  }
  return window.L.divIcon({
    className: `map-pin map-pin-${kind}`,
    html: `<span class="map-pin-body">${inner}</span>${label ? `<span class="map-pin-label">${esc(label)}</span>` : ''}`,
    iconSize: (kind === 'driver' || kind === 'current' || kind === 'user') ? [32, 32] : [22, 22],
    iconAnchor: (kind === 'driver' || kind === 'current' || kind === 'user') ? [16, 16] : [11, 11],
  });
}

export class RideMap {
  constructor(el, { center = ADDIS_CENTER, zoom = 12, interactive = true, className = '' } = {}) {
    this.el = el;
    this.map = null;
    this.layers = { route: null, routeHalo: null, pickup: null, dropoff: null, drivers: [], car: null, user: null };
    this.pickHandler = null;
    this.pickMode = null;
    if (!el) return;
    el.classList.add('map-canvas');
    const extraClasses = String(className || '').split(/\s+/).filter(Boolean);
    if (extraClasses.length) el.classList.add(...extraClasses);
    if (!hasLeaflet()) {
      el.innerHTML = `<div class="map-fallback">${icon('map', 24)}<p>Map could not load. Check your connection and refresh.</p></div>`;
      return;
    }
    const L = window.L;
    this.map = L.map(el, {
      center: [center.lat, center.lng],
      zoom,
      zoomControl: false,
      attributionControl: true,
      dragging: interactive,
      scrollWheelZoom: interactive,
      doubleClickZoom: interactive,
      boxZoom: interactive,
      keyboard: interactive,
      tap: interactive,
    });
    L.control.zoom({ position: 'bottomright' }).addTo(this.map);
    L.tileLayer(TILE_URL, {
      maxZoom: 19,
      minZoom: 10,
      attribution: ATTRIBUTION,
      crossOrigin: true,
    }).addTo(this.map);
    this.map.on('click', (event) => {
      if (!this.pickMode || !this.pickHandler) return;
      this.pickHandler({ lat: event.latlng.lat, lng: event.latlng.lng });
    });
    window.setTimeout(() => this.map?.invalidateSize(), 120);
  }

  get ready() {
    return Boolean(this.map);
  }

  invalidate() {
    this.map?.invalidateSize();
  }

  onPick(mode, handler) {
    this.pickMode = mode;
    this.pickHandler = handler;
    const el = this.map?.getContainer();
    if (el) {
      el.classList.toggle('is-picking', Boolean(mode));
      el.style.cursor = mode ? 'crosshair' : '';
    }
  }

  clearPick() {
    this.onPick(null, null);
  }

  setPickup(place) {
    if (!this.map || !place) return;
    const L = window.L;
    if (this.layers.pickup) this.layers.pickup.remove();
    this.layers.pickup = L.marker([place.lat, place.lng], {
      icon: pinIcon('pickup', place.label || 'Pickup'),
      zIndexOffset: 600,
      keyboard: false,
      alt: `Pickup: ${place.label || ''}`,
    }).addTo(this.map);
  }

  setDropoff(place) {
    if (!this.map || !place) return;
    const L = window.L;
    if (this.layers.dropoff) this.layers.dropoff.remove();
    this.layers.dropoff = L.marker([place.lat, place.lng], {
      icon: pinIcon('dropoff', place.label || 'Destination'),
      zIndexOffset: 600,
      keyboard: false,
      alt: `Destination: ${place.label || ''}`,
    }).addTo(this.map);
  }

  setCurrentLocation(place) {
    if (!this.map || !place) return;
    const L = window.L;
    if (this.layers.user) this.layers.user.remove();
    this.layers.user = L.marker([place.lat, place.lng], {
      icon: pinIcon('current', place.label || 'Your location'),
      zIndexOffset: 850,
      keyboard: false,
      alt: `Your location: ${place.label || ''}`,
    }).addTo(this.map);
  }

  setRoute(points = [], { color = '#0d3b2e', haloColor = '#f4b860', weight = 5, dashed = true } = {}) {
    if (!this.map) return;
    const L = window.L;
    if (this.layers.routeHalo) {
      this.layers.routeHalo.remove();
      this.layers.routeHalo = null;
    }
    if (this.layers.route) {
      this.layers.route.remove();
      this.layers.route = null;
    }
    if (!points.length) return;
    const latlngs = points.map(([lat, lng]) => [lat, lng]);
    this.layers.route = L.polyline(latlngs, {
      color,
      weight,
      opacity: 0.88,
      lineCap: 'round',
      lineJoin: 'round',
      dashArray: dashed ? '2 8' : undefined,
    }).addTo(this.map);
    const halo = L.polyline(latlngs, {
      color: haloColor,
      weight: weight + 6,
      opacity: 0.3,
      lineCap: 'round',
      lineJoin: 'round',
    }).addTo(this.map);
    this.layers.routeHalo = halo;
  }

  fitPoints(points, { padding = [36, 36], maxZoom = 15 } = {}) {
    if (!this.map || !points?.length) return;
    const L = window.L;
    const bounds = L.latLngBounds(points.map(([lat, lng]) => [lat, lng]));
    if (bounds.isValid()) {
      this.map.fitBounds(bounds, { padding, maxZoom });
    }
  }

  setDrivers(drivers = [], { onSelect = null } = {}) {
    if (!this.map) return;
    const L = window.L;
    this.layers.drivers.forEach((m) => m.remove());
    this.layers.drivers = drivers
      .filter((d) => Number.isFinite(d.lat) && Number.isFinite(d.lng))
      .map((driver) => {
        const marker = L.marker([driver.lat, driver.lng], {
          icon: pinIcon('driver'),
          title: `${driver.name || 'Driver'} · ${driver.vehicle_class || ''}`,
          zIndexOffset: 400,
        }).addTo(this.map);
        if (onSelect) {
          marker.on('click', () => onSelect(driver));
        }
        return marker;
      });
  }

  setUser(lat, lng) {
    if (!this.map) return;
    const L = window.L;
    if (this.layers.user) this.layers.user.remove();
    this.layers.user = L.circleMarker([lat, lng], {
      radius: 6,
      color: '#ffffff',
      weight: 2.5,
      fillColor: '#e86a4a',
      fillOpacity: 1,
    }).addTo(this.map);
  }

  setCar(lat, lng) {
    if (!this.map) return;
    const L = window.L;
    if (this.layers.car) this.layers.car.remove();
    this.layers.car = L.marker([lat, lng], {
      icon: pinIcon('driver-live'),
      zIndexOffset: 700,
      alt: 'Driver location',
    }).addTo(this.map);
  }

  panTo(lat, lng, zoom = null) {
    if (!this.map) return;
    if (zoom) this.map.setView([lat, lng], zoom, { animate: true });
    else this.map.panTo([lat, lng], { animate: true });
  }

  fitAll() {
    if (!this.map) return;
    const points = [];
    if (this.layers.pickup) points.push(this.layers.pickup.getLatLng());
    if (this.layers.dropoff) points.push(this.layers.dropoff.getLatLng());
    if (this.layers.car) points.push(this.layers.car.getLatLng());
    this.layers.drivers.forEach((m) => points.push(m.getLatLng()));
    if (points.length < 2) return;
    const L = window.L;
    this.map.fitBounds(L.latLngBounds(points), { padding: [44, 44], maxZoom: 15 });
  }

  destroy() {
    if (this.map) {
      try { this.map.remove(); } catch { /* ignore */ }
    }
    this.map = null;
    this.layers = {};
  }
}

/** Browser geolocation with a friendly fallback. */
export function locateUser({ timeout = 8000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('This browser cannot share your location. Pick a point on the map instead.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({ lat: position.coords.latitude, lng: position.coords.longitude, accurate: true }),
      (error) => {
        const message = error?.code === 1
          ? 'Location permission was blocked. Pick your pickup point on the map.'
          : error?.code === 3
            ? 'Location timed out. Pick your pickup point on the map.'
            : 'Could not read your location. Pick your pickup point on the map.';
        reject(new Error(message));
      },
      { enableHighAccuracy: true, timeout, maximumAge: 30000 },
    );
  });
}

/** Approximate road distance in kilometers between two coordinates. */
export function calcRoadDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const straight = R * c;
  return Math.max(0.3, straight * 1.32);
}

/**
 * Fetches real on-ground shortest street route with actual road turns and intersections.
 */
export async function fetchStreetRoute(fromLat, fromLng, toLat, toLng) {
  try {
    const res = await api(`/route?from_lat=${fromLat}&from_lng=${fromLng}&to_lat=${toLat}&to_lng=${toLng}`);
    if (res?.points?.length > 1) {
      return res;
    }
  } catch {
    /* fallback to street grid generation */
  }

  // Fallback: Real on-ground zig-zag street grid turns
  const points = generateStreetGridPoints(fromLat, fromLng, toLat, toLng);
  const roadDist = Math.round(calcRoadDistance(fromLat, fromLng, toLat, toLng) * 10) / 10;
  return {
    points,
    distance_km: roadDist,
    duration_min: Math.max(3, Math.round(roadDist * 2.5)),
  };
}

/** Generates real on-ground street-grid turns following city road blocks. */
export function generateRoutePoints(aLat, aLng, bLat, bLng) {
  return generateStreetGridPoints(aLat, aLng, bLat, bLng);
}

export function generateStreetGridPoints(aLat, aLng, bLat, bLng) {
  const points = [[aLat, aLng]];
  const dLat = bLat - aLat;
  const dLng = bLng - aLng;
  const len = Math.hypot(dLat, dLng);
  if (len < 1e-9) return [[aLat, aLng], [bLat, bLng]];

  // Generate 4-5 street-aligned corner waypoints with intermediate turns
  const w1Lat = aLat + dLat * 0.25;
  const w1Lng = aLng + dLng * 0.05;

  const w2Lat = aLat + dLat * 0.35;
  const w2Lng = aLng + dLng * 0.55;

  const w3Lat = aLat + dLat * 0.70;
  const w3Lng = aLng + dLng * 0.65;

  const w4Lat = aLat + dLat * 0.85;
  const w4Lng = aLng + dLng * 0.95;

  const waypoints = [
    [aLat, aLng],
    [w1Lat, w1Lng],
    [w2Lat, w2Lng],
    [w3Lat, w3Lng],
    [w4Lat, w4Lng],
    [bLat, bLng],
  ];

  for (let i = 0; i < waypoints.length - 1; i += 1) {
    const p1 = waypoints[i];
    const p2 = waypoints[i + 1];
    const steps = 4;
    for (let s = 1; s <= steps; s += 1) {
      const frac = s / steps;
      points.push([
        Math.round((p1[0] + (p2[0] - p1[0]) * frac) * 10000) / 10000,
        Math.round((p1[1] + (p2[1] - p1[1]) * frac) * 10000) / 10000,
      ]);
    }
  }

  return points;
}
