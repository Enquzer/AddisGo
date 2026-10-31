export const ADDIS_CENTER = { lat: 9.03, lng: 38.74 };

export const PLACES = [
  { id: 'airport', name: 'Bole International Airport', area: 'Bole', lat: 8.9779, lng: 38.7993 },
  { id: 'bole', name: 'Bole Medhanialem', area: 'Bole', lat: 8.995, lng: 38.787 },
  { id: 'meskel', name: 'Meskel Square', area: 'Kirkos', lat: 9.01, lng: 38.761 },
  { id: 'piassa', name: 'Piassa · Churchill Avenue', area: 'Arada', lat: 9.034, lng: 38.75 },
  { id: 'merkato', name: 'Merkato', area: 'Addis Ketema', lat: 9.035, lng: 38.733 },
  { id: 'kazanchis', name: 'Kazanchis · ECA Road', area: 'Kirkos', lat: 9.014, lng: 38.762 },
  { id: 'megenagna', name: 'Megenagna · Ring Road', area: 'Yeka', lat: 9.02, lng: 38.801 },
  { id: 'cmc', name: 'CMC Roundabout', area: 'Yeka', lat: 9.019, lng: 38.827 },
  { id: 'sarbet', name: 'Sarbet · Ethio-China Road', area: 'Nifas Silk', lat: 9.0, lng: 38.735 },
  { id: 'entoto', name: 'Entoto Natural Park', area: 'Gullele', lat: 9.07, lng: 38.765 },
  { id: 'unity', name: 'Unity Park', area: 'Arada', lat: 9.02, lng: 38.76 },
  { id: 'museum', name: 'National Museum', area: 'Arada', lat: 9.016, lng: 38.763 },
  { id: 'summit', name: 'Summit', area: 'Bole', lat: 9.036, lng: 38.84 },
  { id: 'oldairport', name: 'Old Airport', area: 'Nifas Silk', lat: 9.005, lng: 38.75 },
  { id: 'ayat', name: 'Ayat', area: 'Yeka', lat: 9.015, lng: 38.87 },
  { id: 'gerji', name: 'Gerji', area: 'Bole', lat: 8.995, lng: 38.83 },
];

export const RIDE_CLASSES = [
  {
    key: 'e2',
    name: 'Electric E2',
    tagline: 'Quiet, zero-tailpipe city rides',
    seats: 4,
    accent: '#145c45',
    badge: 'Most booked',
  },
  {
    key: 'comfort',
    name: 'Comfort',
    tagline: 'Extra room and a smooth ride',
    seats: 4,
    accent: '#3b6ea5',
    badge: '',
  },
  {
    key: 'van',
    name: 'Tour Van',
    tagline: 'Space for groups and luggage',
    seats: 7,
    accent: '#9c5b3b',
    badge: 'Groups',
  },
];

export const POPULAR_ROUTES = [
  { from: 'Bole International Airport', to: 'Bole Medhanialem', note: 'Airport run', fromPlace: 'airport', toPlace: 'bole' },
  { from: 'Piassa · Churchill Avenue', to: 'Meskel Square', note: 'City centre', fromPlace: 'piassa', toPlace: 'meskel' },
  { from: 'Bole Medhanialem', to: 'Entoto Natural Park', note: 'Sunset ride', fromPlace: 'bole', toPlace: 'entoto' },
  { from: 'Kazanchis · ECA Road', to: 'Megenagna · Ring Road', note: 'Cross-town', fromPlace: 'kazanchis', toPlace: 'megenagna' },
];

export function classByKey(key) {
  return RIDE_CLASSES.find((item) => item.key === key) || RIDE_CLASSES[0];
}

export function placeById(id) {
  return PLACES.find((place) => place.id === id) || null;
}

export function placeByName(name) {
  if (!name) return null;
  const clean = name.trim().toLowerCase();
  return (
    PLACES.find((place) => place.name.toLowerCase() === clean) ||
    PLACES.find((place) => place.name.toLowerCase().includes(clean) || clean.includes(place.name.toLowerCase())) ||
    null
  );
}
