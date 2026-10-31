export const ADDIS_CENTER = { lat: 9.03, lng: 38.74 };

export function haversineDistanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export const PLACES = [
  {
    id: 'airport',
    name: 'Bole International Airport',
    amharic: 'ቦሌ ዓለም አቀፍ አውሮፕላን ማረፊያ',
    area: 'Bole Sub-city',
    landmarkDetail: 'Terminal 1 & 2 Arrivals / Departures',
    icon: 'navigation',
    tone: 'blue',
    lat: 8.9779,
    lng: 38.7993,
    prominence: 100,
    aliases: ['airport', 'terminal 2', 'bole airport', 'ethiopian airlines'],
  },
  {
    id: 'bole',
    name: 'Bole Medhanialem',
    amharic: 'ቦሌ መድኃኔዓለም',
    area: 'Bole Sub-city',
    landmarkDetail: 'Cameroon St · Edna Mall & Cathedral Dome',
    icon: 'map-pin',
    tone: 'green',
    lat: 8.995,
    lng: 38.787,
    prominence: 95,
    aliases: ['medhanialem', 'edna mall', 'cameroon street'],
  },
  {
    id: 'bole_japan',
    name: 'Bole Japan',
    amharic: 'ቦሌ ጃፓን',
    area: 'Bole Sub-city',
    landmarkDetail: 'Behind Rwanda Embassy · Boutique Cafes',
    icon: 'coffee',
    tone: 'blue',
    lat: 8.9915,
    lng: 38.7835,
    prominence: 90,
    aliases: ['rwanda embassy', 'japan embassy', 'japan sefer'],
  },
  {
    id: 'atlas',
    name: 'Bole Atlas',
    amharic: 'ቦሌ አትላስ',
    area: 'Bole Sub-city',
    landmarkDetail: 'Atlas Hotel Junction · Shala Park Corridor',
    icon: 'coffee',
    tone: 'violet',
    lat: 8.9985,
    lng: 38.778,
    prominence: 88,
    aliases: ['atlas hotel', 'shala park', 'chala park'],
  },
  {
    id: 'meskel',
    name: 'Meskel Square',
    amharic: 'መስቀል አደባባይ',
    area: 'Kirkos / Central',
    landmarkDetail: 'Civic Plaza · Addis Stadium & Light Rail Hub',
    icon: 'compass',
    tone: 'green',
    lat: 9.01,
    lng: 38.761,
    prominence: 95,
    aliases: ['stadium', 'red terror museum', 'meskal square'],
  },
  {
    id: 'kazanchis',
    name: 'Kazanchis · ECA Road',
    amharic: 'ካዛንቺስ',
    area: 'Kirkos Sub-city',
    landmarkDetail: 'UNECA Gate · Inter Luxury Hotel & Fendika',
    icon: 'music',
    tone: 'violet',
    lat: 9.014,
    lng: 38.762,
    prominence: 92,
    aliases: ['uneca', 'eca', 'inter luxury', 'fendika', 'kasanchis'],
  },
  {
    id: 'piassa',
    name: 'Piassa · Churchill Avenue',
    amharic: 'ፒያሳ / አራዳ',
    area: 'Arada Sub-city',
    landmarkDetail: 'De Gaulle Square · St. George Cathedral & Tomoca',
    icon: 'landmark',
    tone: 'amber',
    lat: 9.034,
    lng: 38.75,
    prominence: 90,
    aliases: ['churchill avenue', 'arada giorgis', 'tomoca coffee', 'piazza'],
  },
  {
    id: 'merkato',
    name: 'Merkato',
    amharic: 'መርካቶ',
    area: 'Addis Ketema',
    landmarkDetail: 'Africa’s Grand Market · Military Tera & Anwar Mosque',
    icon: 'map-pin',
    tone: 'amber',
    lat: 9.035,
    lng: 38.733,
    prominence: 89,
    aliases: ['mercato', 'autobus tera', 'anwar mosque'],
  },
  {
    id: 'sarbet',
    name: 'Sarbet · Ethio-China Road',
    amharic: 'ሳርቤት',
    area: 'Kirkos / Old Airport',
    landmarkDetail: 'African Union HQ · Karl Square & Canadian Embassy',
    icon: 'shield',
    tone: 'blue',
    lat: 9.0,
    lng: 38.735,
    prominence: 88,
    aliases: ['african union', 'au', 'karl square', 'sar bet'],
  },
  {
    id: 'entoto',
    name: 'Entoto Natural Park',
    amharic: 'እንጦጦ ፓርክ',
    area: 'Gullele Mountain Ridge',
    landmarkDetail: 'Panoramic 3,000m Viewpoint · Trails & Maryam Gate',
    icon: 'leaf',
    tone: 'green',
    lat: 9.07,
    lng: 38.765,
    prominence: 87,
    aliases: ['mount entoto', 'entoto maryam', 'viewpoint'],
  },
  {
    id: 'mexico',
    name: 'Mexico Square',
    amharic: 'ሜክሲኮ አደባባይ',
    area: 'Kirkos Sub-city',
    landmarkDetail: 'CBE Tower Headquarters & Light Rail Transfer',
    icon: 'navigation',
    tone: 'blue',
    lat: 9.0115,
    lng: 38.745,
    prominence: 85,
    aliases: ['cbe tower', 'commercial bank', 'mexico'],
  },
  {
    id: 'museum',
    name: '4 Kilo · National Museum',
    amharic: '4 ኪሎ / ብሔራዊ ሙዚየም',
    area: 'Arada Sub-city',
    landmarkDetail: 'Unity Park & Historic Parliament Corridor',
    icon: 'bookmark',
    tone: 'amber',
    lat: 9.016,
    lng: 38.763,
    prominence: 84,
    aliases: ['4 kilo', 'lucy', 'unity park', 'parliament'],
  },
  {
    id: 'megenagna',
    name: 'Megenagna · Ring Road',
    amharic: 'መገናኛ',
    area: 'Yeka Sub-city',
    landmarkDetail: 'Zefmesh Grand Mall & Transit Overpass',
    icon: 'zap',
    tone: 'violet',
    lat: 9.02,
    lng: 38.801,
    prominence: 83,
    aliases: ['zefmesh', 'megenagna round about'],
  },
  {
    id: 'cmc',
    name: 'CMC Roundabout',
    amharic: 'ሲ ኤም ሲ',
    area: 'Yeka Sub-city',
    landmarkDetail: 'St. Michael Church · Sunshine Real Estate',
    icon: 'map-pin',
    tone: 'blue',
    lat: 9.019,
    lng: 38.827,
    prominence: 80,
    aliases: ['cmc michael', 'sunshine cmc'],
  },
  {
    id: 'gerji',
    name: 'Gerji',
    amharic: 'ገርጂ',
    area: 'Bole Sub-city',
    landmarkDetail: 'Mebrat Hayel Junction · Unity University',
    icon: 'map-pin',
    tone: 'green',
    lat: 8.995,
    lng: 38.83,
    prominence: 78,
    aliases: ['mebrat hayel', 'unity university gerji'],
  },
  {
    id: '22mazoria',
    name: '22 Mazoria',
    amharic: '22 ማዞሪያ',
    area: 'Yeka Sub-city',
    landmarkDetail: 'Haile G/Selassie Avenue · Axum Hotel Corridor',
    icon: 'zap',
    tone: 'violet',
    lat: 9.02,
    lng: 38.788,
    prominence: 77,
    aliases: ['hayahulet', 'axum hotel', '22'],
  },
  {
    id: 'summit',
    name: 'Summit',
    amharic: 'ሰሚት',
    area: 'Bole Sub-city',
    landmarkDetail: 'Summit Condominium · Soft Drink Factory',
    icon: 'map-pin',
    tone: 'amber',
    lat: 9.036,
    lng: 38.84,
    prominence: 76,
    aliases: ['summit condo', 'sumit'],
  },
  {
    id: 'oldairport',
    name: 'Old Airport',
    amharic: 'ኦልድ ኤርፖርት',
    area: 'Nifas Silk',
    landmarkDetail: 'ICS Addis International School · Golf Club',
    icon: 'map-pin',
    tone: 'blue',
    lat: 9.005,
    lng: 38.75,
    prominence: 75,
    aliases: ['ics', 'old air port', 'golf club'],
  },
  {
    id: 'ayat',
    name: 'Ayat',
    amharic: 'አያት',
    area: 'Yeka Sub-city',
    landmarkDetail: 'Ayat Zone 2 · Light Rail Terminal',
    icon: 'navigation',
    tone: 'green',
    lat: 9.015,
    lng: 38.87,
    prominence: 74,
    aliases: ['ayat square', 'ayat zone 2', 'ayat lrt'],
  },
  {
    id: 'gotera',
    name: 'Gotera Interchange',
    amharic: 'ጎተራ ማዞሪያ',
    area: 'Kirkos / Nifas Silk',
    landmarkDetail: 'Ethio-China Avenue · Pepsi Factory Flyover',
    icon: 'navigation',
    tone: 'blue',
    lat: 8.990,
    lng: 38.752,
    prominence: 72,
    aliases: ['gotera', 'pepsi factory', 'ethio china'],
  },
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
    PLACES.find((place) => (place.aliases || []).some((a) => clean.includes(a) || a.includes(clean))) ||
    null
  );
}

export function searchPlaces(rawQuery, originCoords = null) {
  const q = String(rawQuery || '').trim().toLowerCase();

  let candidates = PLACES.map((p) => {
    let score = 0;
    const nameLower = p.name.toLowerCase();
    const areaLower = (p.area || '').toLowerCase();
    const amharicLower = (p.amharic || '').toLowerCase();
    const detailLower = (p.landmarkDetail || '').toLowerCase();
    const aliasMatch = (p.aliases || []).some((a) => a.startsWith(q) || a.includes(q));

    if (!q) {
      score = p.prominence || 10;
    } else if (nameLower.startsWith(q)) {
      score = 120 - nameLower.indexOf(q);
    } else if (nameLower.split(' ').some((word) => word.startsWith(q))) {
      score = 100;
    } else if (nameLower.includes(q)) {
      score = 80;
    } else if (amharicLower.includes(q)) {
      score = 90;
    } else if (aliasMatch) {
      score = 75;
    } else if (areaLower.includes(q) || detailLower.includes(q)) {
      score = 60;
    }

    let distanceKm = null;
    if (originCoords && typeof originCoords.lat === 'number' && typeof originCoords.lng === 'number') {
      distanceKm = haversineDistanceKm(originCoords.lat, originCoords.lng, p.lat, p.lng);
    }

    return { ...p, score, distanceKm };
  });

  if (q) {
    candidates = candidates.filter((c) => c.score > 0);
    candidates.sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score;
      if (a.distanceKm !== null && b.distanceKm !== null) return a.distanceKm - b.distanceKm;
      return (b.prominence || 0) - (a.prominence || 0);
    });
  } else if (originCoords) {
    candidates.sort((a, b) => (a.distanceKm ?? 999) - (b.distanceKm ?? 999));
  } else {
    candidates.sort((a, b) => (b.prominence || 0) - (a.prominence || 0));
  }

  return candidates.slice(0, 7);
}
