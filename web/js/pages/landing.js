import { api } from '../api.js';
import { state } from '../store.js';
import { icon, logoMark } from '../ui/icons.js';
import { esc, money, dateTime, minutes } from '../ui/format.js';
import { themeImage } from '../ui/booking.js';
import { fetchStreetRoute } from '../ui/map.js';

const POPULAR_AREAS = [
  {
    name: 'Bole Japan',
    amharic: 'ቦሌ ጃፓን',
    subcity: 'Bole Sub-city',
    taxiTip: 'Bole Japan sefer, behind Rwanda Embassy',
    amharicPhonetic: 'ቦሌ ጃፓን ሰፈር፣ ከሩዋንዳ ኤምባሲ ጀርባ',
    fareEstimate: '220–280 ETB',
    highlights: 'Tomoca Roastery · Edna Mall corridor · Boutique cafes',
    tone: 'blue',
    lat: 8.9915,
    lng: 38.7835,
    icon: 'coffee',
    imageUrl: '/assets/landmarks/bole_japan.jpg',
  },
  {
    name: 'Kazanchis',
    amharic: 'ካዛንቺስ',
    subcity: 'Kirkos Sub-city',
    taxiTip: 'Kazanchis, opposite UNECA & Inter Luxury Hotel',
    amharicPhonetic: 'ካዛንቺስ፣ ከኢሲኤ መግቢያ ፊትለፊት',
    fareEstimate: '180–240 ETB',
    highlights: 'Fendika Cultural Centre · UNECA · Inter Luxury',
    tone: 'violet',
    lat: 9.0142,
    lng: 38.7625,
    icon: 'music',
    imageUrl: '/assets/landmarks/kazanchis.jpg',
  },
  {
    name: 'Meskel Square',
    amharic: 'መስቀል አደባባይ',
    subcity: 'Central Addis',
    taxiTip: 'Meskel Square, Light Rail transit station & Stadium',
    amharicPhonetic: 'መስቀል አደባባይ፣ እስቴዲየም አካባቢ',
    fareEstimate: '190–250 ETB',
    highlights: 'Red Terror Martyrs Memorial · Light Rail Hub',
    tone: 'green',
    lat: 9.0108,
    lng: 38.7618,
    icon: 'compass',
    imageUrl: '/assets/landmarks/meskel.jpg',
  },
  {
    name: 'Piazza / Arada',
    amharic: 'ፒያሳ / አራዳ',
    subcity: 'Arada Sub-city',
    taxiTip: 'Arada Giorgis, near Tomoca & original Italian bakeries',
    amharicPhonetic: 'አራዳ ጊዮርጊስ፣ ቶሞካ ቡና ወይም ፖስታ ቤት',
    fareEstimate: '210–270 ETB',
    highlights: 'St. George Cathedral · Enrico Pastry · Silver shops',
    tone: 'amber',
    lat: 9.0345,
    lng: 38.7516,
    icon: 'landmark',
    imageUrl: '/assets/landmarks/piassa.jpg',
  },
  {
    name: 'Sarbet',
    amharic: 'ሳርቤት',
    subcity: 'Kirkos / Old Airport',
    taxiTip: 'Sarbet, Karl Square near Canadian Embassy & AU',
    amharicPhonetic: 'ሳርቤት፣ ካናዳ ኤምባሲ ወይም ካርል አደባባይ',
    fareEstimate: '230–300 ETB',
    highlights: 'African Union HQ · ICS Addis · International bistros',
    tone: 'blue',
    lat: 9.0012,
    lng: 38.7365,
    icon: 'shield',
    imageUrl: '/assets/landmarks/sarbet.jpg',
  },
  {
    name: 'Bole Medhanialem',
    amharic: 'ቦሌ መድኃኔዓለም',
    subcity: 'Bole Sub-city',
    taxiTip: 'Bole Medhanialem Cathedral, Cameroon St malls',
    amharicPhonetic: 'ቦሌ መድኃኔዓለም ቤተክርስቲያን አካባቢ',
    fareEstimate: '200–260 ETB',
    highlights: 'Cathedral · Edna Mall · Specialty dining & shopping',
    tone: 'green',
    lat: 8.9953,
    lng: 38.7889,
    icon: 'map-pin',
    imageUrl: '/assets/landmarks/bole_medhanialem.jpg',
  },
  {
    name: 'Entoto Park Ridge',
    amharic: 'እንጦጦ ፓርክ',
    subcity: 'North Gullele',
    taxiTip: 'Entoto Natural Park, main ridge gate & Maryam church',
    amharicPhonetic: 'እንጦጦ ፓርክ፣ ዋና በር ወይም ማርያም',
    fareEstimate: '320–420 ETB',
    highlights: 'Sunset viewpoint · Eucalyptus trails · Fresh mountain air',
    tone: 'green',
    lat: 9.0732,
    lng: 38.7654,
    icon: 'leaf',
    imageUrl: '/assets/landmarks/entoto.jpg',
  },
  {
    name: 'Bole Atlas',
    amharic: 'ቦሌ አትላስ',
    subcity: 'Bole Sub-city',
    taxiTip: 'Atlas Hotel junction, Shala park corridor',
    amharicPhonetic: 'አትላስ ሆቴል መታጠፊያ፣ ሻላ ፓርክ',
    fareEstimate: '190–250 ETB',
    highlights: 'Boutique lounges · 24/7 cafes · Live music',
    tone: 'violet',
    lat: 8.9985,
    lng: 38.7780,
    icon: 'coffee',
    imageUrl: '/assets/landmarks/atlas.jpg',
  },
  {
    name: 'Mexico',
    amharic: 'ሜክሲኮ',
    subcity: 'Kirkos Sub-city',
    taxiTip: 'Mexico Square, near Commercial Bank tower & LRT',
    amharicPhonetic: 'ሜክሲኮ አደባባይ፣ ባቡር ጣቢያ',
    fareEstimate: '180–230 ETB',
    highlights: 'Commercial business district · Light rail transfer',
    tone: 'blue',
    lat: 9.0115,
    lng: 38.7450,
    icon: 'navigation',
    imageUrl: '/assets/landmarks/mexico.jpg',
  },
  {
    name: '4 Kilo',
    amharic: '4 ኪሎ',
    subcity: 'Arada Sub-city',
    taxiTip: '4 Kilo monument, near Addis Ababa University & Parliament',
    amharicPhonetic: '4 ኪሎ ሐውልት፣ ዩኒቨርሲቲ',
    fareEstimate: '200–260 ETB',
    highlights: 'National Museum · Unity Park · Historic universities',
    tone: 'amber',
    lat: 9.0340,
    lng: 38.7620,
    icon: 'bookmark',
    imageUrl: '/assets/landmarks/4kilo.jpg',
  },
  {
    name: 'Gerji',
    amharic: 'ገርጂ',
    subcity: 'Bole Sub-city',
    taxiTip: 'Gerji, Mebrat Hayel junction & Unity University',
    amharicPhonetic: 'ገርጂ፣ መብራት ኃይል',
    fareEstimate: '210–270 ETB',
    highlights: 'Residential cafes · Artisan bakeries · Quiet leafy lanes',
    tone: 'green',
    lat: 8.9950,
    lng: 38.8300,
    icon: 'map-pin',
    imageUrl: '/assets/landmarks/gerji.jpg',
  },
  {
    name: '22 Mazoria',
    amharic: '22 ማዞሪያ',
    subcity: 'Yeka Sub-city',
    taxiTip: '22 Mazoria, near Axum Hotel & Haile G/Selassie Ave',
    amharicPhonetic: '22 ማዞሪያ፣ አክሱም ሆቴል',
    fareEstimate: '190–250 ETB',
    highlights: 'Transit hub · Traditional tej houses · Live acoustic music',
    tone: 'violet',
    lat: 9.0200,
    lng: 38.7880,
    icon: 'zap',
    imageUrl: '/assets/landmarks/22mazoria.jpg',
  },
];

export default async function renderLanding(view, ctx = {}) {
  const user = ctx.user || state.user;
  const isAuthed = Boolean(user);

  view.innerHTML = `
    <section class="landing-page">
      <!-- Hero Section with Horizontal Dual-Screen Flip Phone Showcase (Side by Side) -->
      <section class="hero-section">
        <div class="hero-container-side-by-side">
          <!-- LEFT COLUMN: Headline, Value Proposition, Action CTAs & Metrics -->
          <div class="hero-content-col">
            ${isAuthed ? `
              <div class="user-welcome-banner">
                <span class="user-welcome-dot"></span>
                <span>Welcome back, <strong>${esc(user?.name?.split(' ')[0] || 'rider')}</strong></span>
                <span class="user-welcome-sep">·</span>
                <a href="#/ride" class="user-welcome-link">${icon('car', 13)} Book a ride</a>
                <span class="user-welcome-sep">·</span>
                <a href="#/trips" class="user-welcome-link">${icon('route', 13)} My trips</a>
              </div>
            ` : ''}
            <div class="hero-badge">
              <span class="badge-dot"></span>
              <span>Addis Ababa · Electric city rides &amp; tours</span>
            </div>

            <h1 class="hero-title">
              Find your way around <span class="hero-highlight">Addis.</span>
            </h1>

            <p class="hero-desc">
              Quiet electric city rides, verified local guides, and small-group tours across Addis Ababa.
              Upfront ETB fares, live driver tracking, and real neighbourhood directions to tell your taxi driver.
            </p>

            <div class="hero-cta-row">
              <a class="btn btn-hero-dark" href="${isAuthed ? '#/ride' : '#/register'}">
                ${icon('car', 18)} ${isAuthed ? 'Request a ride' : 'Get started'}
              </a>
              <a class="btn btn-hero-ghost" href="#/tours">
                ${icon('compass', 18)} Browse city tours
              </a>
              <div class="hero-qr-badge">
                <img src="/assets/qr-app.png" alt="Scan with phone" class="qr-thumb" />
                <span class="qr-text">Scan with your<br /><b>phone camera</b></span>
              </div>
            </div>

            <!-- Stats Counter Row (Directly below CTAs in Left Column) -->
            <div class="hero-metrics" id="hero-metrics">
              <div class="metric-item">
                <strong id="metric-drivers">12+</strong>
                <small>Electric E2s online</small>
              </div>
              <div class="metric-item">
                <strong>140+</strong>
                <small>Neighbourhood names</small>
              </div>
              <div class="metric-item">
                <strong>100%</strong>
                <small>Upfront ETB fares</small>
              </div>
              <div class="metric-item">
                <strong>4.9 ★</strong>
                <small>Average driver rating</small>
              </div>
            </div>
          </div>

          <!-- RIGHT COLUMN: The Horizontal Dual-Screen Smart Flip Phone Showcase -->
          <div class="hero-device-col-side">
            <div class="device-stage-horizontal" id="phone-stage">
              <!-- Ambient City Glow Backdrop -->
              <div class="device-ambient-horizontal" aria-hidden="true">
                <img src="/assets/home/city.jpg" alt="" class="ambient-img" />
              </div>

              <!-- NEXT-GEN HORIZONTAL DUAL-SCREEN FLIP PHONE CHASSIS -->
              <div class="horiz-flip-chassis" role="region" aria-label="AddisGo on Horizontal Dual-Screen Foldable Phone">
                <!-- Outer Titanium Frame & Edge Details -->
                <div class="horiz-frame-rim"></div>
                <div class="horiz-antenna ant-left-top"></div>
                <div class="horiz-antenna ant-right-bottom"></div>

                <!-- Floating Badge 1 (Left: Screen 1 active badge) -->
                <div class="horiz-phone-badge badge-left-ride" id="left-phone-badge">
                  <span class="badge-icon-box bg-green-soft">${icon('zap', 16)}</span>
                  <div class="badge-copy">
                    <span class="badge-label">Electric E2 arriving</span>
                    <strong>Dawit · 3 min away</strong>
                  </div>
                </div>

                <!-- Floating Badge 2 (Right: Screen 2 active badge) -->
                <div class="horiz-phone-badge badge-right-landmark" id="right-phone-badge">
                  <span class="badge-icon-box bg-cyan-soft">${icon('users', 16)}</span>
                  <div class="badge-copy">
                    <span class="badge-label">Ride Share Matched</span>
                    <strong>Split fare · 140 ETB each</strong>
                  </div>
                </div>

                <!-- LEFT SCREEN HALF: Multi-Feature Dynamic Carousel -->
                <div class="horiz-half-panel half-left">
                  <div class="screen-chassis-inner screen-left-inner">
                    <!-- Screen 1 Status Bar -->
                    <div class="phone-screen-bar">
                      <span class="phone-time">9:41</span>
                      <span class="screen-feature-pill" id="left-status-pill">${icon('zap', 11)} Live E2 Booking</span>
                      <span class="phone-signals">5G ${icon('zap', 11)} 98%</span>
                    </div>

                    <!-- Screen 1 Panel 1: Live Electric E2 Booking with Google-Like Navigation Map -->
                    <div class="left-view-panel is-active" id="left-view-liveride">
                      <div class="mini-ride-map" role="region" aria-label="Google Maps Style Navigation from Bole to Meskel Square">
                        <!-- Google Maps Turn-by-Turn Instruction Banner -->
                        <div class="gmap-turn-banner">
                          <div class="gmap-turn-left">
                            <span class="gmap-turn-arrow">↱</span>
                            <span>250m · Head onto <strong>Africa Ave (Bole Rd)</strong></span>
                          </div>
                          <span class="gmap-eta-badge">8 min (3.8 km)</span>
                        </div>

                        <!-- Google Maps Addis Ababa Terrain, Streets & Route SVG -->
                        <svg class="mini-map-svg" viewBox="0 0 340 138" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                          <!-- Land Terrain Base -->
                          <rect width="340" height="138" fill="#e8eaed" />

                          <!-- Green Parks (Africa Park, Millennium Park corridor) -->
                          <path d="M 170 12 C 190 6, 230 14, 255 28 C 245 42, 210 46, 175 32 Z" fill="#cde8d5" />
                          <path d="M 15 75 C 35 70, 65 78, 75 98 C 55 110, 25 105, 12 92 Z" fill="#d4ebd8" />
                          <path d="M 270 95 C 295 90, 325 100, 335 125 C 310 135, 280 130, 265 115 Z" fill="#cde8d5" />

                          <!-- Street Grid Outlines (Casing) -->
                          <line x1="0" y1="35" x2="340" y2="35" stroke="#d5d8dc" stroke-width="5" />
                          <line x1="0" y1="72" x2="340" y2="72" stroke="#d5d8dc" stroke-width="5" />
                          <line x1="0" y1="112" x2="340" y2="112" stroke="#d5d8dc" stroke-width="5" />
                          <line x1="45" y1="0" x2="45" y2="138" stroke="#d5d8dc" stroke-width="5" />
                          <line x1="125" y1="0" x2="125" y2="138" stroke="#d5d8dc" stroke-width="5" />
                          <line x1="215" y1="0" x2="215" y2="138" stroke="#d5d8dc" stroke-width="5" />
                          <line x1="290" y1="0" x2="290" y2="138" stroke="#d5d8dc" stroke-width="5" />

                          <!-- White Road Grid Surfaces -->
                          <line x1="0" y1="35" x2="340" y2="35" stroke="#ffffff" stroke-width="3.5" />
                          <line x1="0" y1="72" x2="340" y2="72" stroke="#ffffff" stroke-width="3.5" />
                          <line x1="0" y1="112" x2="340" y2="112" stroke="#ffffff" stroke-width="3.5" />
                          <line x1="45" y1="0" x2="45" y2="138" stroke="#ffffff" stroke-width="3.5" />
                          <line x1="125" y1="0" x2="125" y2="138" stroke="#ffffff" stroke-width="3.5" />
                          <line x1="215" y1="0" x2="215" y2="138" stroke="#ffffff" stroke-width="3.5" />
                          <line x1="290" y1="0" x2="290" y2="138" stroke="#ffffff" stroke-width="3.5" />

                          <!-- Africa Avenue / Bole Road Arterial Highway (Google Yellow) -->
                          <path d="M 45 105 L 75 105 L 75 82 L 195 82 L 240 52 L 275 42" stroke="#f9bb49" stroke-width="8" stroke-linecap="round" stroke-linejoin="round" />
                          <circle cx="275" cy="42" r="14" fill="#e8eaed" stroke="#f9bb49" stroke-width="5" />
                          <path d="M 45 105 L 75 105 L 75 82 L 195 82 L 240 52 L 275 42" stroke="#fde293" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" />

                          <!-- Google Maps Navigation Shortest Street Route (Vibrant Blue Zig-Zag) -->
                          <path d="M 45 105 L 75 105 L 75 82 L 195 82 L 240 52 L 275 42" stroke="#1557b0" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round" />
                          <path d="M 45 105 L 75 105 L 75 82 L 195 82 L 240 52 L 275 42" stroke="#1a73e8" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" class="route-svg-glow-gmap" />

                          <!-- Direction Arrows along street segments -->
                          <path d="M 65 105 L 60 102 M 65 105 L 60 108" stroke="#ffffff" stroke-width="1.8" stroke-linecap="round" />
                          <path d="M 140 82 L 135 79 M 140 82 L 135 85" stroke="#ffffff" stroke-width="1.8" stroke-linecap="round" />
                          <path d="M 220 65 L 215 62 M 220 65 L 217 68" stroke="#ffffff" stroke-width="1.8" stroke-linecap="round" />

                          <!-- Street Labels in Google Maps Typography -->
                          <text x="100" y="76" font-size="7.5" font-family="system-ui, -apple-system, Roboto, sans-serif" fill="#5f6368" font-weight="600">Africa Ave (Bole Rd)</text>
                          <text x="180" y="26" font-size="7" font-family="system-ui, -apple-system, Roboto, sans-serif" fill="#188038" font-weight="600">Africa Park</text>
                          <text x="245" y="62" font-size="7.5" font-family="system-ui, -apple-system, Roboto, sans-serif" fill="#5f6368" font-weight="600">Meskel Sq</text>

                          <!-- Google Maps Origin Blue Pulsing Puck (Bole Medhanialem) -->
                          <circle cx="45" cy="105" r="9" fill="rgba(26, 115, 232, 0.25)" class="pulse-marker-gmap" />
                          <circle cx="45" cy="105" r="5" fill="#1a73e8" stroke="#ffffff" stroke-width="2" />

                          <!-- Moving Electric Vehicle Icon Puck -->
                          <g class="moving-car-gmap">
                            <circle cx="145" cy="82" r="10" fill="#ffffff" stroke="#1a73e8" stroke-width="2" filter="drop-shadow(0 2px 3px rgba(0,0,0,0.25))" />
                            <text x="145" y="85.5" font-size="9" text-anchor="middle" fill="#00114b" font-weight="bold">⚡</text>
                          </g>

                          <!-- Google Maps Destination Red Drop Pin (Meskel Sq) -->
                          <g transform="translate(267, 18)">
                            <path d="M8 0C3.58 0 0 3.58 0 8C0 14 8 23 8 23C8 23 16 14 16 8C16 3.58 12.42 0 8 0Z" fill="#ea4335" stroke="#ffffff" stroke-width="1.2" filter="drop-shadow(0 2px 3px rgba(0,0,0,0.3))" />
                            <circle cx="8" cy="8" r="3" fill="#ffffff" />
                          </g>
                        </svg>

                        <!-- Google Maps Navigation Waypoints -->
                        <div class="mini-map-tags">
                          <span class="tag-pin tag-start">${icon('map-pin', 11)} Bole Medhanialem</span>
                          <span class="tag-pin tag-end">${icon('navigation', 11)} Meskel Sq</span>
                        </div>
                      </div>

                      <div class="mini-driver-card">
                        <div class="driver-card-top">
                          <div class="driver-avatar-circle">D</div>
                          <div class="driver-info-meta">
                            <strong>Dawit Mekonnen</strong>
                            <small>BYD Atto 3 · AA 3 B 12345 · 4.95 ★</small>
                          </div>
                          <span class="eta-pill">3 min away</span>
                        </div>
                        <div class="driver-fare-row">
                          <div><small>Upfront fare</small><strong>ETB 280</strong></div>
                          <span class="driver-status-badge">${icon('check', 11)} Driver en route</span>
                        </div>
                      </div>
                    </div>

                    <!-- Screen 1 Panel 2: Verified City Tours & Guided Walks -->
                    <div class="left-view-panel" id="left-view-tours" hidden>
                      <div class="tour-showcase-box">
                        <div class="tour-showcase-media">
                          <img src="/assets/tours/entoto.jpg" alt="Entoto Ridge Sunset Walk" class="tour-showcase-img" />
                          <span class="tour-showcase-tag">Verified City Tour</span>
                          <span class="tour-showcase-price">350 ETB</span>
                        </div>
                        <div class="tour-showcase-info">
                          <div class="tour-info-row">
                            <h4>Sunset over Entoto Ridge</h4>
                            <span class="members-badge">${icon('users', 11)} 4 spots left</span>
                          </div>
                          <p class="tour-showcase-meta">${icon('map-pin', 11)} Entoto Maryam ➔ Eucalypt Trails ➔ Shiro Meda</p>
                          <div class="group-chat-quote">
                            <span class="chat-speaker">Guide Selam:</span>
                            <em>“We stop at historic St. Mary church &amp; panoramic city viewpoint.”</em>
                          </div>
                        </div>
                      </div>
                    </div>

                    <!-- Screen 1 Panel 3: Airport Scheduled Pickup -->
                    <div class="left-view-panel" id="left-view-airport" hidden>
                      <div class="airport-showcase-box">
                        <div class="showcase-header">
                          <span class="landmark-zone-pill">${icon('calendar', 11)} Bole Int'l Airport</span>
                          <span class="flight-live-tag">Flight ET-501 Tracked</span>
                        </div>
                        <div class="airport-route-detail">
                          <div class="terminal-badge">${icon('navigation', 12)} Terminal 2 Arrivals ➔ Kazanchis</div>
                          <div class="pickup-meet-spot">Meet inside terminal · Driver holding name sign</div>
                        </div>
                        <div class="airport-driver-row">
                          <div class="driver-avatar-circle bg-blue">S</div>
                          <div class="driver-info-meta">
                            <strong>Samuel Girma</strong>
                            <small>BYD E2 Comfort · Free 45-min airport wait</small>
                          </div>
                          <span class="eta-pill tone-blue">Scheduled</span>
                        </div>
                        <div class="driver-fare-row">
                          <div><small>Upfront fixed fare</small><strong>ETB 350</strong></div>
                          <span class="driver-status-badge">${icon('check', 11)} No airport surge</span>
                        </div>
                      </div>
                    </div>

                    <!-- Screen 1 Panel 4: Safety Pass & Contactless QR Check-in -->
                    <div class="left-view-panel" id="left-view-safety" hidden>
                      <div class="safety-showcase-box">
                        <div class="showcase-header">
                          <span class="landmark-zone-pill tone-green">${icon('shield', 11)} Safety Desk Protected</span>
                          <span class="pass-code-pill">Pass AG-749210</span>
                        </div>
                        <div class="qr-verify-card">
                          <div class="qr-mock-thumb">
                            <img src="/assets/qr-app.png" alt="Pass QR" class="qr-micro-img" />
                          </div>
                          <div class="qr-verify-text">
                            <strong>Show code to driver</strong>
                            <small>Confirms your car instantly. Phone numbers stay private.</small>
                          </div>
                        </div>
                        <div class="safety-action-row">
                          <span class="safety-chip">${icon('shield', 11)} 24/7 Desk SOS</span>
                          <span class="safety-chip">${icon('eye', 11)} Share live trip</span>
                          <span class="safety-chip">${icon('check-circle', 11)} Verified DL</span>
                        </div>
                      </div>
                    </div>

                    <!-- Screen 1 Feature Switcher Navigation -->
                    <div class="left-screen-nav">
                      <button type="button" class="left-tab-pill is-active" data-left-preset="liveride">
                        ${icon('zap', 10)} Live E2
                      </button>
                      <button type="button" class="left-tab-pill" data-left-preset="tours">
                        ${icon('compass', 10)} City Tours
                      </button>
                      <button type="button" class="left-tab-pill" data-left-preset="airport">
                        ${icon('calendar', 10)} Airport
                      </button>
                      <button type="button" class="left-tab-pill" data-left-preset="safety">
                        ${icon('shield', 10)} QR Pass
                      </button>
                    </div>
                  </div>
                </div>

                <!-- CENTER VERTICAL PRECISION HINGE MECHANISM -->
                <div class="horiz-center-hinge" aria-hidden="true">
                  <span class="hinge-bracket hinge-bracket-top"></span>
                  <div class="hinge-spine-vertical">
                    <span class="crease-light-beam"></span>
                  </div>
                  <span class="hinge-bracket hinge-bracket-bottom"></span>
                </div>

                <!-- RIGHT SCREEN HALF: Ride Share & Social Group Connections -->
                <div class="horiz-half-panel half-right">
                  <div class="screen-chassis-inner screen-right-inner">
                    <!-- Screen 2 Status Bar -->
                    <div class="phone-screen-bar">
                      <span class="phone-time">9:41</span>
                      <span class="screen-feature-pill tone-cyan" id="right-status-pill">${icon('users', 11)} Co-Rider Match</span>
                      <span class="phone-signals">Online</span>
                    </div>

                    <!-- Screen 2 Panel 1: Live Ride Share Match (Strangers Splitting an E2) -->
                    <div class="right-view-panel is-active" id="right-view-rideshare">
                      <div class="rideshare-showcase-box">
                        <div class="showcase-header">
                          <span class="landmark-zone-pill tone-green">${icon('car', 11)} Shared E2 Route</span>
                          <span class="fare-split-tag">50% Fare Saved</span>
                        </div>
                        <div class="match-corridor-row">
                          <div class="corridor-route">
                            <strong>Bole ➔ Meskel Square</strong>
                            <small>2 co-riders heading same way</small>
                          </div>
                          <span class="corridor-fare">140 ETB <small>/ each</small></span>
                        </div>
                        <div class="co-rider-card">
                          <div class="co-rider-avatars">
                            <div class="avatar-pill av-1">M</div>
                            <div class="avatar-pill av-2">J</div>
                          </div>
                          <div class="co-rider-info">
                            <strong>Meron B. &amp; Jake M.</strong>
                            <small>Pickup at Bole Medhanialem corner</small>
                          </div>
                        </div>
                        <div class="rideshare-chat-snippet">
                          <div class="chat-bubble-mini">
                            <span>${icon('message', 10)}</span>
                            <em>“I'm outside Edna Mall by the cafe in blue jacket.”</em>
                          </div>
                        </div>
                        <div class="showcase-foot-tip">
                          ${icon('shield', 11)}
                          <span>Verified riders · Numbers private · Split fare</span>
                        </div>
                      </div>
                    </div>

                    <!-- Screen 2 Panel 2: Shared Tour & Group Chat (Strangers connecting to explore together) -->
                    <div class="right-view-panel" id="right-view-tourgroup" hidden>
                      <div class="tour-showcase-box">
                        <div class="tour-showcase-media">
                          <img src="/assets/tours/entoto.jpg" alt="Entoto Ridge Sunset" class="tour-showcase-img" />
                          <span class="tour-showcase-tag">Small-Group Tour</span>
                          <span class="tour-showcase-price">350 ETB</span>
                        </div>
                        <div class="tour-showcase-info">
                          <div class="tour-info-row">
                            <h4>Sunset over Entoto Ridge</h4>
                            <span class="members-badge">${icon('users', 11)} 4 joined</span>
                          </div>
                          <p class="tour-showcase-meta">${icon('calendar', 11)} Today 4:00 PM · Main Gate · Selam T.</p>
                          <div class="group-chat-quote">
                            <span class="chat-speaker">Jake M.:</span>
                            <em>“Anyone near Bole want to share a van to the gate?”</em>
                          </div>
                        </div>
                      </div>
                    </div>

                    <!-- Screen 2 Panel 3: Taxi Landmark Guide -->
                    <div class="right-view-panel" id="right-view-landmark" hidden>
                      <div class="landmark-showcase-box">
                        <div class="showcase-header">
                          <span class="landmark-zone-pill">${icon('map-pin', 11)} Bole · Airport Corridor</span>
                          <span class="audio-badge">${icon('volume-2', 11)} Audio Tip</span>
                        </div>
                        <div class="showcase-title-row">
                          <div>
                            <h3>Bole Japan</h3>
                            <span class="geez-script-lg">ቦሌ ጃፓን</span>
                          </div>
                          <button type="button" class="audio-play-demo" aria-label="Listen to pronunciation">
                            <span class="audio-wave"></span>
                            <span class="audio-wave"></span>
                            <span class="audio-wave"></span>
                            <span class="audio-wave"></span>
                          </button>
                        </div>
                        <div class="driver-instruction-bubble">
                          <small>Say to your taxi driver:</small>
                          <p class="instruction-quote">“Bole Japan sefer, behind Rwanda Embassy”</p>
                          <p class="instruction-amharic">“ቦሌ ጃፓን ሰፈር፣ ከሩዋንዳ ኤምባሲ ጀርባ”</p>
                        </div>
                        <div class="showcase-foot-tip">
                          ${icon('info', 12)}
                          <span>Famous for fresh Tomoca coffee roasteries &amp; Edna Mall link</span>
                        </div>
                      </div>
                    </div>

                    <!-- Screen 2 Panel 4: Bole After Dark Food Crawl -->
                    <div class="right-view-panel" id="right-view-foodcrawl" hidden>
                      <div class="tour-showcase-box">
                        <div class="tour-showcase-media">
                          <img src="/assets/tours/bole.jpg" alt="Bole Food Crawl" class="tour-showcase-img" />
                          <span class="tour-showcase-tag">Tasting Tour</span>
                          <span class="tour-showcase-price">500 ETB</span>
                        </div>
                        <div class="tour-showcase-info">
                          <div class="tour-info-row">
                            <h4>Bole After Dark: Food Crawl</h4>
                            <span class="members-badge">${icon('users', 11)} 5 joined</span>
                          </div>
                          <p class="tour-showcase-meta">${icon('calendar', 11)} Tonight 7:00 PM · Medhanialem · Nahom K.</p>
                          <div class="group-chat-quote">
                            <span class="chat-speaker">Nahom (Host):</span>
                            <em>“Vegetarian &amp; tej wine tasting arranged for our 3rd stop!”</em>
                          </div>
                        </div>
                      </div>
                    </div>

                    <!-- Right Screen Preset Switcher (Tabs at bottom) -->
                    <div class="right-screen-nav">
                      <button type="button" class="right-tab-pill is-active" data-preset="rideshare">
                        ${icon('users', 10)} Co-Rider
                      </button>
                      <button type="button" class="right-tab-pill" data-preset="tourgroup">
                        ${icon('compass', 10)} Tour Group
                      </button>
                      <button type="button" class="right-tab-pill" data-preset="landmark">
                        ${icon('map-pin', 10)} Taxi Drop
                      </button>
                      <button type="button" class="right-tab-pill" data-preset="foodcrawl">
                        ${icon('coffee', 10)} Food Crawl
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- CONSOLIDATED EXPLORER HUB: Landmarks, Tours & Fleet in One Compact View -->
      <section class="section-hub" id="explore-hub">
        <div class="section-container">
          <div class="hub-header-row">
            <div>
              <p class="section-eyebrow">Explore Addis</p>
              <h2 class="section-headline">One hub for rides, tours &amp; vehicles</h2>
            </div>
            <div class="hub-pill-switcher" role="tablist" aria-label="Explore Addis switcher">
              <button type="button" class="hub-tab-btn is-active" role="tab" aria-selected="true" data-hub-target="hub-panel-landmarks">
                ${icon('map-pin', 14)} Landmarks &amp; Drops
              </button>
              <button type="button" class="hub-tab-btn" role="tab" aria-selected="false" data-hub-target="hub-panel-tours">
                ${icon('compass', 14)} Guided Tours
              </button>
              <button type="button" class="hub-tab-btn" role="tab" aria-selected="false" data-hub-target="hub-panel-fleet">
                ${icon('zap', 14)} Clean Fleet
              </button>
            </div>
          </div>

          <!-- TAB PANEL 1: Landmarks & Taxi Drops (3D Interactive Map + Linked Text + Spotlight) -->
          <div class="hub-panel is-active" id="hub-panel-landmarks" role="tabpanel">
            <!-- Linked Text Location Quick Navigation Strip -->
            <div class="linked-landmark-strip" role="tablist" aria-label="Addis Landmark Quick Jump">
              <span class="linked-strip-label">${icon('navigation', 13)} Quick Jump:</span>
              <div class="linked-strip-scroll">
                ${POPULAR_AREAS.map((area, idx) => `
                  <button type="button" class="linked-landmark-chip ${idx === 0 ? 'is-active' : ''}" data-landmark-idx="${idx}" role="tab" aria-selected="${idx === 0 ? 'true' : 'false'}">
                    <span class="chip-icon-box tone-${esc(area.tone)}">${icon(area.icon || 'map-pin', 12)}</span>
                    <span class="chip-name">${esc(area.name)}</span>
                    <span class="chip-fare">${esc(area.fareEstimate.split('–')[0])} ETB</span>
                  </button>
                `).join('')}
              </div>
            </div>

            <!-- Interactive Map Stage + Spotlight Info Layout -->
            <div class="interactive-3d-hub-layout">
              <!-- Map Stage -->
              <div class="landmark-3d-stage" id="landmark-3d-stage">
                <div class="landmark-3d-map" id="landmark-3d-map" aria-label="Interactive Addis Map"></div>
                <div class="landmark-3d-hud">
                  <div class="hud-controls-group">
                    <button type="button" class="hud-toggle-pill is-active" id="btn-layer-street" title="Switch to Street Map">
                      ${icon('map', 12)} <span>Street</span>
                    </button>
                    <button type="button" class="hud-toggle-pill" id="btn-layer-sat" title="Switch to Satellite Street View">
                      ${icon('globe', 12)} <span>Satellite</span>
                    </button>
                    <button type="button" class="hud-toggle-pill is-active" id="btn-user-loc" title="Find my location (You are here)">
                      <span class="user-pulse-dot"></span> <span>You are here</span>
                    </button>
                    <button type="button" class="hud-toggle-pill" id="btn-recenter-map" title="Recenter Map on Central Addis">
                      ${icon('navigation', 12)} <span>Center</span>
                    </button>
                  </div>
                </div>
              </div>

              <!-- Active Landmark Spotlight Card -->
              <div class="smart-landmark-preview" id="smart-landmark-preview"></div>
            </div>

            <div class="hub-foot-action">
              <a class="btn btn-outline" href="${isAuthed ? '#/ride' : '#/register'}">
                ${icon('map-pin', 14)} Book ride to any custom landmark in Addis
              </a>
            </div>
          </div>

          <!-- TAB PANEL 2: Guided Tours -->
          <div class="hub-panel" id="hub-panel-tours" role="tabpanel" hidden>
            <div class="clean-tours-row" id="landing-tours-list">
              <div class="clean-tour-card-skeleton"></div>
              <div class="clean-tour-card-skeleton"></div>
              <div class="clean-tour-card-skeleton"></div>
            </div>
            <div class="hub-foot-action">
              <a class="btn btn-outline" href="#/tours">
                ${icon('compass', 14)} View all guided tours &amp; itineraries
              </a>
            </div>
          </div>

          <!-- TAB PANEL 3: Clean Fleet & Sustainability -->
          <div class="hub-panel" id="hub-panel-fleet" role="tabpanel" hidden>
            <div class="electric-mini-banner">
              <div class="electric-mini-lead">
                <span class="electric-badge">${icon('zap', 14)} 100% Electric E2 Fleet</span>
                <h3>Quiet streets, clean air, renewable power</h3>
                <p>Ethiopia generates over 90% of its power from clean hydro &amp; wind. Every AddisGo EV trip is emission-free.</p>
              </div>
              <div class="electric-mini-stats">
                <div class="mini-stat"><strong>0g</strong><small>Tailpipe CO₂</small></div>
                <div class="mini-stat"><strong>400 km</strong><small>EV Daily Range</small></div>
                <div class="mini-stat"><strong>100%</strong><small>Renewable Power</small></div>
              </div>
            </div>

            <div class="fleet-grid">
              <div class="fleet-card">
                <div class="fleet-icon-box">${icon('zap', 22)}</div>
                <div class="fleet-meta">
                  <strong>Electric E2</strong>
                  <small>Quiet, modern EV · 4 seats</small>
                </div>
                <p>The quietest way across Addis. Great for airport runs and everyday city hops.</p>
              </div>

              <div class="fleet-card">
                <div class="fleet-icon-box">${icon('car', 22)}</div>
                <div class="fleet-meta">
                  <strong>Comfort Sedan</strong>
                  <small>Spacious AC ride · 4 seats</small>
                </div>
                <p>Roomy sedans with generous legroom for business meetings and longer cross-town trips.</p>
              </div>

              <div class="fleet-card">
                <div class="fleet-icon-box">${icon('users', 22)}</div>
                <div class="fleet-meta">
                  <strong>Tour Van</strong>
                  <small>Group travel &amp; luggage · 7 seats</small>
                </div>
                <p>Spacious high-roof vans for group tours, Entoto day trips, and airport luggage runs.</p>
              </div>
            </div>

            <div class="hub-foot-action">
              <a class="btn btn-outline" href="${isAuthed ? '#/ride' : '#/login'}">
                ${icon('car', 14)} Estimate ride in any vehicle
              </a>
            </div>
          </div>
        </div>
      </section>

      <!-- Sleek Addis-Inspired Footer -->
      <footer class="landing-footer">
        <div class="section-container">
          <!-- Addis City News & Updates Newsletter Strip -->
          <div class="newsletter-strip">
            <div class="newsletter-copy">
              <h4>${icon('mail', 18)} Stay connected to Addis</h4>
              <p>Get weekend walking tours, new electric charging routes, and curated Addis city discoveries directly to your email.</p>
            </div>
            <form class="newsletter-form" id="newsletter-form">
              <input type="email" name="email" placeholder="Enter your email (e.g. yourname@gmail.com)" required />
              <button type="submit" class="btn btn-primary">Subscribe</button>
            </form>
          </div>
          <div id="newsletter-status" class="newsletter-status" aria-live="polite"></div>
        </div>

        <div class="section-container footer-grid">
          <div class="footer-brand-col">
            <a class="footer-brand" href="#/">
              ${logoMark(32)}
              <span><strong>AddisGo</strong></span>
            </a>
            <p>Digital mobility and local discoveries for Addis Ababa, Ethiopia. Quiet electric rides, verified guides, and clear local neighbourhood landmarks.</p>
            <p class="footer-contact">Addis Ababa, Ethiopia · support@addisgo.et</p>
          </div>

          <div class="footer-nav-col">
            <h4>Rides</h4>
            <a href="#/ride">Book a ride</a>
            <a href="#/trips">Trips &amp; receipts</a>
            <a href="#/register">Drive with AddisGo</a>
          </div>

          <div class="footer-nav-col">
            <h4>Explore</h4>
            <a href="#/tours">City tours</a>
            <a href="#/welcome">Why AddisGo</a>
            <a href="#/profile">Safety centre</a>
          </div>

          <div class="footer-nav-col">
            <h4>Legal &amp; Privacy</h4>
            <a href="#/terms">Terms &amp; Conditions</a>
            <a href="#/privacy">Privacy Policy (GDPR)</a>
            <a href="#/cookies">Cookie Rights &amp; Policy</a>
            <a href="#/legal">Legal Disclaimers</a>
          </div>

          <div class="footer-nav-col">
            <h4>Account</h4>
            <a href="#/login">Sign in</a>
            <a href="#/register">Create account</a>
            <a href="mailto:support@addisgo.et">Support &amp; Feedback</a>
          </div>
        </div>

        <div class="section-container footer-bottom">
          <span>&copy; ${new Date().getFullYear()} AddisGo Ltd. All rights reserved. Registered in Ethiopia.</span>
          <div class="footer-legal-links">
            <a href="#/terms">Terms</a> · 
            <a href="#/privacy">Privacy</a> · 
            <a href="#/cookies">Cookies</a> · 
            <a href="#/legal">Disclaimers</a>
          </div>
          <span class="footer-sub">Designed for Addis Ababa, Ethiopia · Global Compliance</span>
        </div>
      </footer>
    </section>
  `;

  // --- Horizontal Dual-Screen Phone Interactive Controller ---
  const stage = view.querySelector('#phone-stage');

  // Left Screen (Screen 1): Mobility, City Tours & Live Dispatch
  const leftTabs = view.querySelectorAll('.left-tab-pill');
  const leftPanels = {
    liveride: view.querySelector('#left-view-liveride'),
    tours: view.querySelector('#left-view-tours'),
    airport: view.querySelector('#left-view-airport'),
    safety: view.querySelector('#left-view-safety'),
  };
  const leftBadge = view.querySelector('#left-phone-badge');
  const leftStatus = view.querySelector('#left-status-pill');

  const leftPresetData = {
    liveride: {
      icon: 'zap',
      iconClass: 'bg-green-soft',
      label: 'Electric E2 arriving',
      value: 'Dawit · 3 min away · Bole ➔ Meskel',
      statusPill: `${icon('zap', 11)} Live E2 Booking`,
    },
    tours: {
      icon: 'compass',
      iconClass: 'bg-amber-soft',
      label: 'Guided City Tour',
      value: 'Entoto Sunset · 4 spots left · ETB 350',
      statusPill: `${icon('compass', 11)} Guided City Tours`,
    },
    airport: {
      icon: 'calendar',
      iconClass: 'bg-blue-soft',
      label: 'Flight ET-501 Tracked',
      value: 'Samuel · Bole Terminal 2',
      statusPill: `${icon('calendar', 11)} Airport Dispatch`,
    },
    safety: {
      icon: 'shield',
      iconClass: 'bg-green-soft',
      label: 'Pass AG-749210',
      value: 'Verified Driver · SOS 24/7',
      statusPill: `${icon('shield', 11)} QR Safety Pass`,
    },
  };
  const leftPresetKeys = ['liveride', 'tours', 'airport', 'safety'];
  let activeLeftIdx = 0;

  const setLeftPreset = (key) => {
    leftTabs.forEach((tab) => {
      tab.classList.toggle('is-active', tab.dataset.leftPreset === key);
    });
    Object.entries(leftPanels).forEach(([k, panel]) => {
      if (panel) {
        const isActive = k === key;
        panel.hidden = !isActive;
        panel.classList.toggle('is-active', isActive);
      }
    });
    const info = leftPresetData[key];
    if (info) {
      if (leftBadge) {
        leftBadge.innerHTML = `
          <span class="badge-icon-box ${info.iconClass}">${icon(info.icon, 16)}</span>
          <div class="badge-copy">
            <span class="badge-label">${esc(info.label)}</span>
            <strong>${esc(info.value)}</strong>
          </div>
        `;
      }
      if (leftStatus) {
        leftStatus.innerHTML = info.statusPill;
      }
    }
    activeLeftIdx = leftPresetKeys.indexOf(key);
  };

  leftTabs.forEach((tab) => {
    tab.addEventListener('click', (e) => {
      const preset = e.currentTarget.dataset.leftPreset;
      setLeftPreset(preset);
      resetAutoTimer();
    });
  });

  // Right Screen (Screen 2): Ride Sharing, Social Groups & Taxi Guide
  const rightTabs = view.querySelectorAll('.right-tab-pill');
  const rightPanels = {
    rideshare: view.querySelector('#right-view-rideshare'),
    tourgroup: view.querySelector('#right-view-tourgroup'),
    landmark: view.querySelector('#right-view-landmark'),
    foodcrawl: view.querySelector('#right-view-foodcrawl'),
  };
  const rightBadge = view.querySelector('#right-phone-badge');
  const rightStatus = view.querySelector('#right-status-pill');

  const rightPresetData = {
    rideshare: {
      icon: 'users',
      iconClass: 'bg-cyan-soft',
      label: 'Ride Share Matched',
      value: 'Split fare · 140 ETB each',
      statusPill: `${icon('users', 11)} Co-Rider Match`,
    },
    tourgroup: {
      icon: 'compass',
      iconClass: 'bg-amber-soft',
      label: 'Small-Group Tour',
      value: 'Entoto Sunset · 4 joined',
      statusPill: `${icon('compass', 11)} Tour Group`,
    },
    landmark: {
      icon: 'map-pin',
      iconClass: 'bg-cyan-soft',
      label: 'Taxi Drop Tip',
      value: 'Bole Japan · Audio Guide',
      statusPill: `${icon('map-pin', 11)} Taxi Landmark`,
    },
    foodcrawl: {
      icon: 'coffee',
      iconClass: 'bg-amber-soft',
      label: 'Food Crawl Live',
      value: 'Bole After Dark · 5 joined',
      statusPill: `${icon('coffee', 11)} Tasting Tour`,
    },
  };
  const rightPresetKeys = ['rideshare', 'tourgroup', 'landmark', 'foodcrawl'];
  let activeRightIdx = 0;

  const setRightPreset = (key) => {
    rightTabs.forEach((tab) => {
      tab.classList.toggle('is-active', tab.dataset.preset === key);
    });
    Object.entries(rightPanels).forEach(([k, panel]) => {
      if (panel) {
        const isActive = k === key;
        panel.hidden = !isActive;
        panel.classList.toggle('is-active', isActive);
      }
    });
    const info = rightPresetData[key];
    if (info) {
      if (rightBadge) {
        rightBadge.innerHTML = `
          <span class="badge-icon-box ${info.iconClass}">${icon(info.icon, 16)}</span>
          <div class="badge-copy">
            <span class="badge-label">${esc(info.label)}</span>
            <strong>${esc(info.value)}</strong>
          </div>
        `;
      }
      if (rightStatus) {
        rightStatus.innerHTML = info.statusPill;
      }
    }
    activeRightIdx = rightPresetKeys.indexOf(key);
  };

  rightTabs.forEach((tab) => {
    tab.addEventListener('click', (e) => {
      const preset = e.currentTarget.dataset.preset;
      setRightPreset(preset);
      resetAutoTimer();
    });
  });

  // Automated Synchronized Cycling across both screens
  let isHovered = false;
  let timerId = null;

  const resetAutoTimer = () => {
    if (timerId) clearInterval(timerId);
    startTimer();
  };

  const startTimer = () => {
    if (timerId) clearInterval(timerId);
    timerId = setInterval(() => {
      if (!isHovered) {
        const nextLeftIdx = (activeLeftIdx + 1) % leftPresetKeys.length;
        const nextRightIdx = (activeRightIdx + 1) % rightPresetKeys.length;
        setLeftPreset(leftPresetKeys[nextLeftIdx]);
        setRightPreset(rightPresetKeys[nextRightIdx]);
      }
    }, 4500);
  };

  if (stage) {
    stage.addEventListener('mouseenter', () => { isHovered = true; });
    stage.addEventListener('mouseleave', () => { isHovered = false; });
    stage.addEventListener('focusin', () => { isHovered = true; });
    stage.addEventListener('focusout', () => { isHovered = false; });
    startTimer();
  }

  // --- Explorer Hub Tab Switcher ---
  const hubTabButtons = view.querySelectorAll('.hub-tab-btn');
  const hubPanels = view.querySelectorAll('.hub-panel');
  hubTabButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-hub-target');
      hubTabButtons.forEach((b) => {
        const isCurrent = b === btn;
        b.classList.toggle('is-active', isCurrent);
        b.setAttribute('aria-selected', isCurrent ? 'true' : 'false');
      });
      hubPanels.forEach((panel) => {
        const matches = panel.id === targetId;
        panel.classList.toggle('is-active', matches);
        panel.hidden = !matches;
      });
      if (targetId === 'hub-panel-landmarks' && leafletMap) {
        setTimeout(() => leafletMap.invalidateSize(), 80);
      }
    });
  });

  // --- Interactive Map & Landmark Spotlight ---
  const mapContainer = view.querySelector('#landmark-3d-map');
  const stageContainer = view.querySelector('#landmark-3d-stage');
  const previewContainer = view.querySelector('#smart-landmark-preview');
  const chips = view.querySelectorAll('.linked-landmark-chip');
  const btnLayerStreet = view.querySelector('#btn-layer-street');
  const btnLayerSat = view.querySelector('#btn-layer-sat');
  const btnUserLoc = view.querySelector('#btn-user-loc');
  const btnRecenter = view.querySelector('#btn-recenter-map');

  let leafletMap = null;
  let currentTileLayer = null;
  let activeLayerType = 'street';
  let markers = [];
  let activeIdx = 0;

  // User "You are here" Location State
  let userCoords = { lat: 9.0108, lng: 38.7618 }; // Default to central Meskel Square / Bole corridor
  let userMarker = null;
  let userGuideLine = null;
  let userGuideLineHalo = null;

  const calcStraightDistance = (lat1, lon1, lat2, lon2) => {
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
    return Math.max(0.3, Math.round(R * c * 1.25 * 10) / 10);
  };

  const setLayer = (type) => {
    if (!leafletMap || typeof window.L === 'undefined') return;
    const L = window.L;
    activeLayerType = type;

    if (currentTileLayer) {
      leafletMap.removeLayer(currentTileLayer);
      currentTileLayer = null;
    }

    if (type === 'sat') {
      currentTileLayer = L.tileLayer('https://mt{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
        subdomains: ['0', '1', '2', '3'],
        maxZoom: 20,
        maxNativeZoom: 20,
        attribution: '&copy; Google Satellite / Imagery',
      }).addTo(leafletMap);

      currentTileLayer.on('tileerror', (e) => {
        if (e?.tile && !e.tile.__fallback) {
          e.tile.__fallback = true;
          const { z, y, x } = e.coords;
          e.tile.src = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
        }
      });
    } else {
      currentTileLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap contributors',
      }).addTo(leafletMap);
    }

    btnLayerStreet?.classList.toggle('is-active', type === 'street');
    btnLayerSat?.classList.toggle('is-active', type === 'sat');
    setTimeout(() => {
      if (leafletMap) leafletMap.invalidateSize();
    }, 60);
  };

  const updateUserLocationMarker = async () => {
    if (!leafletMap || typeof window.L === 'undefined') return;
    const L = window.L;
    const activeArea = POPULAR_AREAS[activeIdx] || POPULAR_AREAS[0];
    const straightDist = calcStraightDistance(userCoords.lat, userCoords.lng, activeArea.lat, activeArea.lng);
    let distKm = straightDist;
    let estMin = Math.max(3, Math.round(distKm * 2.5));

    const hereHtml = `
      <div class="user-here-pulse-wrap" title="You are here (Click to center)">
        <div class="user-here-radar"></div>
        <div class="user-here-core">
          ${icon('navigation', 13)}
        </div>
        <div class="user-here-callout">
          <span class="here-tag">You are here</span>
          <span class="here-dist" id="here-dist-text">${distKm} km to ${esc(activeArea.name)} (~${estMin} min)</span>
        </div>
      </div>
    `;

    const hereIcon = L.divIcon({
      className: 'user-here-div-icon',
      html: hereHtml,
      iconSize: [42, 42],
      iconAnchor: [21, 21],
    });

    if (userMarker) {
      userMarker.setLatLng([userCoords.lat, userCoords.lng]);
      userMarker.setIcon(hereIcon);
    } else {
      userMarker = L.marker([userCoords.lat, userCoords.lng], {
        icon: hereIcon,
        zIndexOffset: 1200,
      }).addTo(leafletMap);

      userMarker.on('click', () => {
        leafletMap.flyTo([userCoords.lat, userCoords.lng], 15, { duration: 0.8 });
      });
    }

    // Fetch actual on-ground driving road navigation path following street turns and curves
    try {
      const routeData = await fetchStreetRoute(userCoords.lat, userCoords.lng, activeArea.lat, activeArea.lng);
      if (routeData?.points?.length > 1) {
        if (userGuideLineHalo) {
          leafletMap.removeLayer(userGuideLineHalo);
          userGuideLineHalo = null;
        }
        if (userGuideLine) {
          leafletMap.removeLayer(userGuideLine);
          userGuideLine = null;
        }

        userGuideLineHalo = L.polyline(routeData.points, {
          color: '#34d399',
          weight: 7,
          opacity: 0.35,
          lineCap: 'round',
          lineJoin: 'round',
        }).addTo(leafletMap);

        userGuideLine = L.polyline(routeData.points, {
          color: '#059669',
          weight: 3.5,
          dashArray: '6, 8',
          opacity: 0.95,
          lineCap: 'round',
          lineJoin: 'round',
        }).addTo(leafletMap);

        const hereDistEl = view.querySelector('#here-dist-text');
        if (hereDistEl) {
          hereDistEl.textContent = `${routeData.distance_km} km to ${activeArea.name} (~${routeData.duration_min} min drive)`;
        }
        const spotDistEl = view.querySelector('#spotlight-dist-val');
        if (spotDistEl) {
          spotDistEl.innerHTML = `<strong>${routeData.distance_km} km</strong> driving route (~${routeData.duration_min} min)`;
        }
      }
    } catch {
      /* fallback */
    }
  };

  btnLayerStreet?.addEventListener('click', () => setLayer('street'));
  btnLayerSat?.addEventListener('click', () => setLayer('sat'));
  btnUserLoc?.addEventListener('click', () => {
    if (!leafletMap || typeof window.L === 'undefined') return;
    const L = window.L;
    const activeArea = POPULAR_AREAS[activeIdx] || POPULAR_AREAS[0];
    const bounds = L.latLngBounds([
      [userCoords.lat, userCoords.lng],
      [activeArea.lat, activeArea.lng],
    ]);
    leafletMap.flyToBounds(bounds.pad(0.28), { duration: 0.8 });
  });
  btnRecenter?.addEventListener('click', () => {
    if (leafletMap) {
      leafletMap.flyTo([9.018, 38.765], 13, { duration: 0.8 });
    }
  });

  const renderLandmarkPreview = (idx) => {
    const area = POPULAR_AREAS[idx] || POPULAR_AREAS[0];
    if (!previewContainer || !area) return;
    const distKm = calcStraightDistance(userCoords.lat, userCoords.lng, area.lat, area.lng);
    const estMin = Math.max(3, Math.round(distKm * 2.5));

    previewContainer.innerHTML = `
      <article class="smart-spotlight-card tone-${esc(area.tone)}">
        <div class="spotlight-media-wrap">
          <img src="${esc(area.imageUrl || '/assets/home/city.jpg')}" alt="${esc(area.name)}" class="spotlight-media-img" loading="eager" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='/assets/home/city.jpg';" />
          <div class="spotlight-media-overlay">
            <span class="spotlight-badge">${icon(area.icon || 'map-pin', 12)} ${esc(area.subcity)}</span>
            <span class="spotlight-fare-pill">${icon('wallet', 12)} ${esc(area.fareEstimate)}</span>
          </div>
        </div>

        <div class="spotlight-body">
          <div class="spotlight-header">
            <div class="spotlight-title-group">
              <h3>${esc(area.name)} <span class="spotlight-geez">${esc(area.amharic)}</span></h3>
            </div>
            <div class="spotlight-distance-pill" title="Actual on-ground driving distance from your location">
              ${icon('car', 12)} <span id="spotlight-dist-val"><strong>${distKm} km</strong> driving route (~${estMin} min)</span>
            </div>
          </div>

          <div class="spotlight-bubble">
            <div class="bubble-tag">${icon('car', 12)} Tell your taxi driver:</div>
            <p class="bubble-en">“${esc(area.taxiTip)}”</p>
            <p class="bubble-am">${esc(area.amharicPhonetic)}</p>
          </div>

          <div class="spotlight-highlights">
            ${icon('check-circle', 14)} <span>${esc(area.highlights)}</span>
          </div>

          <div class="spotlight-foot">
            <a class="btn btn-primary btn-sm" href="${isAuthed ? `#/ride?drop=${encodeURIComponent(area.name)}` : '#/register'}">
              ${icon('car', 14)} Book ride to ${esc(area.name)} ${icon('arrow-right', 12)}
            </a>
          </div>
        </div>
      </article>
    `;
  };

  const selectLandmark = (idx, panMap = true) => {
    activeIdx = idx;
    const area = POPULAR_AREAS[idx];
    if (!area) return;

    // Update chips
    chips.forEach((c) => {
      const match = Number(c.getAttribute('data-landmark-idx')) === idx;
      c.classList.toggle('is-active', match);
      c.setAttribute('aria-selected', match ? 'true' : 'false');
      if (match) c.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    });

    // Update map markers
    view.querySelectorAll('.map-pin-3d').forEach((pin) => {
      pin.classList.toggle('is-active', Number(pin.dataset.idx) === idx);
    });

    // Pan map directly to street view of location
    if (panMap && leafletMap) {
      leafletMap.flyTo([area.lat, area.lng], 15, { duration: 0.8 });
    }

    updateUserLocationMarker();
    renderLandmarkPreview(idx);
  };

  chips.forEach((chip) => {
    chip.addEventListener('click', () => {
      const idx = Number(chip.getAttribute('data-landmark-idx') || 0);
      selectLandmark(idx, true);
    });
  });

  // Initialize Leaflet Map with actual street tiles and 3D pins
  if (mapContainer && window.L) {
    const L = window.L;
    try {
      leafletMap = L.map(mapContainer, {
        center: [9.018, 38.765],
        zoom: 13,
        zoomControl: true,
        attributionControl: false,
        scrollWheelZoom: false,
        dragging: true,
        tap: true,
      });

      // Default to actual Street Map
      setLayer('street');

      // Connected City Transit Corridors Line (Real on-ground driving routes)
      const corridorStops = [
        [9.0732, 38.7654], // Entoto Ridge
        [9.0345, 38.7516], // Piassa
        [9.0108, 38.7618], // Meskel Sq
        [9.0012, 38.7365], // Sarbet
        [9.0108, 38.7618], // Meskel Sq
        [9.0142, 38.7625], // Kazanchis
        [8.9985, 38.7780], // Atlas
        [8.9953, 38.7889], // Bole Medhanialem
        [8.9915, 38.7835], // Bole Japan
      ];

      let transitPolyline = null;
      let transitHalo = null;

      const loadTransitCorridors = async () => {
        try {
          const legPromises = [];
          for (let i = 0; i < corridorStops.length - 1; i += 1) {
            const [lat1, lng1] = corridorStops[i];
            const [lat2, lng2] = corridorStops[i + 1];
            legPromises.push(fetchStreetRoute(lat1, lng1, lat2, lng2));
          }
          const legs = await Promise.all(legPromises);
          const allRoadPoints = [];
          for (const leg of legs) {
            if (leg?.points) allRoadPoints.push(...leg.points);
          }
          if (allRoadPoints.length > 1) {
            if (transitHalo) leafletMap.removeLayer(transitHalo);
            if (transitPolyline) leafletMap.removeLayer(transitPolyline);

            transitHalo = L.polyline(allRoadPoints, {
              color: '#60a5fa',
              weight: 6,
              opacity: 0.35,
              lineCap: 'round',
              lineJoin: 'round',
            }).addTo(leafletMap);

            transitPolyline = L.polyline(allRoadPoints, {
              color: '#2563eb',
              weight: 3.5,
              opacity: 0.88,
              dashArray: '6, 8',
              lineCap: 'round',
              lineJoin: 'round',
            }).addTo(leafletMap);
          }
        } catch {
          /* keep fallback */
        }
      };
      loadTransitCorridors();

      // Add pins with small logo icons on mentioned spots
      POPULAR_AREAS.forEach((area, idx) => {
        const pinIcon = L.divIcon({
          className: 'custom-3d-marker-wrap',
          html: `
            <div class="map-pin-3d tone-${area.tone} ${idx === 0 ? 'is-active' : ''}" id="map-pin-${idx}" data-idx="${idx}">
              <div class="pin-3d-pulse"></div>
              <div class="pin-3d-head">
                <span class="pin-3d-icon">${icon(area.icon || 'map-pin', 14)}</span>
              </div>
              <div class="pin-3d-stem"></div>
              <div class="pin-3d-badge">
                <strong>${esc(area.name)}</strong>
                <small>${esc(area.fareEstimate.split('–')[0])} ETB</small>
              </div>
            </div>
          `,
          iconSize: [44, 52],
          iconAnchor: [22, 50],
        });

        const marker = L.marker([area.lat, area.lng], { icon: pinIcon }).addTo(leafletMap);
        marker.on('click', () => {
          selectLandmark(idx, false);
        });
        markers.push(marker);
      });

      // Initialize "You are here" user marker
      updateUserLocationMarker();

      // Check browser GPS geolocation
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            const { latitude, longitude } = pos.coords;
            if (latitude >= 8.5 && latitude <= 9.5 && longitude >= 38.3 && longitude <= 39.2) {
              userCoords = { lat: latitude, lng: longitude };
              updateUserLocationMarker();
              renderLandmarkPreview(activeIdx);
            }
          },
          () => {
            /* Keep default central Addis location */
          },
          { timeout: 8000, enableHighAccuracy: true }
        );
      }

      // Invalidate sizes after layout settle to render tiles crisply
      setTimeout(() => {
        if (leafletMap) leafletMap.invalidateSize();
      }, 100);
      setTimeout(() => {
        if (leafletMap) leafletMap.invalidateSize();
      }, 400);
    } catch (err) {
      console.warn('Could not initialize landing map', err);
    }
  }

  selectLandmark(0, false);

  // --- Dynamic Stats Fetch ---
  const driversMetric = view.querySelector('#metric-drivers');
  try {
    const stats = await api('/public/stats');
    if (driversMetric && stats.drivers_online !== undefined) {
      driversMetric.textContent = `${stats.drivers_online || 12}+`;
    }
  } catch {
    /* fallback metric is already rendered */
  }

  // --- Dynamic Tours Fetch with Vibrant Photos ---
  const toursListEl = view.querySelector('#landing-tours-list');
  try {
    const data = await api('/tours');
    const tours = (data.tours || []).slice(0, 3);
    if (toursListEl) {
      if (!tours.length) {
        toursListEl.innerHTML = `<p class="muted">New upcoming tours are being curated. Check back soon.</p>`;
      } else {
        toursListEl.innerHTML = tours.map((tour) => `
          <a class="clean-tour-card" href="#/tour/${tour.id}">
            <div class="clean-tour-media">
              <img src="${esc(themeImage(tour.theme))}" alt="${esc(tour.title)}" class="clean-tour-photo" loading="lazy" />
              <div class="clean-tour-overlay" aria-hidden="true"></div>
              <span class="tour-tag theme-${esc(tour.theme)}">${esc(tour.theme || 'City')}</span>
              <span class="tour-spots">${tour.spots_left} spots left</span>
            </div>
            <div class="clean-tour-body">
              <h3 class="tour-title">${esc(tour.title)}</h3>
              <p class="tour-meta-line">${icon('map-pin', 13)} ${esc(tour.meeting_point)}</p>
              <p class="tour-meta-line">${icon('calendar', 13)} ${esc(dateTime(tour.starts_at))} · ${esc(minutes(tour.duration_min))}</p>
              <div class="tour-card-foot">
                <span class="tour-price">${tour.price === 0 ? 'Free' : money(tour.price)}</span>
                <span class="text-link">Explore ${icon('arrow-right', 13)}</span>
              </div>
            </div>
          </a>
        `).join('');
      }
    }
  } catch {
    if (toursListEl) {
      toursListEl.innerHTML = `<p class="muted">Tours are currently loading. Browse the tours catalog.</p>`;
    }
  }

  // --- Newsletter Subscription Handler ---
  const newsletterForm = view.querySelector('#newsletter-form');
  const newsletterStatus = view.querySelector('#newsletter-status');
  if (newsletterForm && newsletterStatus) {
    newsletterForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = newsletterForm.querySelector('input[type="email"]');
      const email = input.value.trim();
      if (!email) return;
      newsletterStatus.innerHTML = '<span class="newsletter-msg loading">Subscribing...</span>';
      try {
        const res = await api('/newsletter/subscribe', { method: 'POST', body: { email } });
        newsletterStatus.innerHTML = `<span class="newsletter-msg success">✓ ${esc(res.message || 'Subscribed! Check your inbox.')}</span>`;
        newsletterForm.reset();
      } catch (err) {
        newsletterStatus.innerHTML = `<span class="newsletter-msg error">✕ ${esc(err.message || 'Failed to subscribe. Please try again.')}</span>`;
      }
    });
  }

  return () => {
    if (timerId) clearInterval(timerId);
    if (leafletMap) {
      try { leafletMap.remove(); } catch { /* ignore */ }
      leafletMap = null;
    }
  };
}
