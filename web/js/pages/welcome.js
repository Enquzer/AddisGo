import { icon, logoMark } from '../ui/icons.js';
import { esc } from '../ui/format.js';

const PILLARS = [
  {
    icon: 'zap',
    tag: 'Clean Mobility',
    title: 'Electric-first city fleet',
    desc: 'Our electric E2 fleet produces zero tailpipe emissions and glides silently through Addis Ababa’s busy neighbourhoods, charged from Ethiopia’s renewable hydro and wind grid.',
  },
  {
    icon: 'map-pin',
    tag: 'Local Landmark Index',
    title: 'Directions taxi drivers actually know',
    desc: 'Standard GPS street names fail in Addis. AddisGo integrates 140+ real neighbourhood names and drop landmarks — like Bole Japan, Kazanchis, and Sarbet.',
  },
  {
    icon: 'wallet',
    tag: 'Fair Pricing',
    title: 'Upfront ETB fares, zero haggling',
    desc: 'See the exact fare before you book. No airport curb negotiations, no surge price gouging, and instant digital receipts in Ethiopian Birr (ETB) for every single trip.',
  },
  {
    icon: 'shield',
    tag: 'Verified Trust',
    title: 'Safety desk & verified passes',
    desc: 'Every driver licence and plate number is manually verified by our team. Riders verify their pickup with a unique pass code, keeping contact details private.',
  },
];

const FAQS = [
  {
    q: 'How are AddisGo ride fares calculated?',
    a: 'Fares are calculated upfront from distance and route duration in Ethiopian Birr (ETB). The price you see when booking is the exact price you pay — traffic delays will never inflate your fare.',
  },
  {
    q: 'What is the check-in pass code at pickup?',
    a: 'Every ride generates an AG-XXXXXX code and QR pass. When your driver arrives, show or read your code to confirm you have the right car. Your personal phone number stays protected.',
  },
  {
    q: 'Can I schedule a pickup ahead of time for Bole Airport?',
    a: 'Yes! You can schedule rides up to 7 days in advance. An approved driver will be assigned to meet you right outside the arrivals terminal with flight tracking and 45-min free wait time.',
  },
  {
    q: 'How do small-group city tours and ride sharing work?',
    a: 'Tours are hosted by verified local guides in groups of 2 to 15. You meet at a designated landmark, explore together, and connect via the built-in group chat. You can also match with co-riders heading the same way to split fares 50%.',
  },
  {
    q: 'Is payment available in cash or Telebirr?',
    a: 'Yes, AddisGo supports direct Telebirr payments and cash payments directly to your driver with instant digital receipts generated in your account.',
  },
  {
    q: 'Why does AddisGo use local neighbourhood names instead of street numbers?',
    a: 'In Addis Ababa, taxis and minibuses navigate by landmarks, embassies, hotels, and sefer names (e.g., Bole Rwanda, Piassa De Gaulle, Merkato Gate 1). AddisGo translates modern maps into directions your driver instantly recognizes.',
  },
];

const HOW_IT_WORKS = [
  {
    step: '01',
    title: 'Pick a real neighbourhood landmark',
    desc: 'Type or choose from 140+ Addis drop points. See exact Amharic phonetic instructions to tell your driver or taxi operator.',
    icon: 'map-pin',
  },
  {
    step: '02',
    title: 'Match with a verified electric car',
    desc: 'Get matched with an inspected Electric E2 driver. See their licence plate, rating, and upfront fixed ETB fare before confirming.',
    icon: 'car',
  },
  {
    step: '03',
    title: 'Verify with your Safety Pass code',
    desc: 'Show your 6-digit AG-XXXXXX safety code to your driver. No phone numbers exchanged, with 24/7 safety desk monitoring.',
    icon: 'shield',
  },
];

export default async function renderWelcome(view, ctx = {}) {
  const isAuthed = Boolean(ctx.user);
  document.title = 'Why AddisGo · Electric City Rides & Local Guides';

  view.innerHTML = `
    <section class="welcome-page">
      <div class="welcome-hero">
        <div class="section-container">
          <div class="welcome-hero-content">
            <span class="welcome-badge">
              <span class="badge-dot"></span>
              Why AddisGo · The Mission
            </span>
            <h1 class="welcome-title">Moving through Addis, <br /><span class="hero-highlight">without the stress.</span></h1>
            <p class="welcome-lead">
              No haggling at the airport curb. No mystery fares. Just quiet electric rides, honest local guides, and community trust across Addis Ababa.
            </p>
            <div class="welcome-hero-actions">
              <a class="btn btn-hero-dark" href="${isAuthed ? '#/ride' : '#/register'}">
                ${icon('car', 18)} ${isAuthed ? 'Book an electric ride' : 'Create an account'}
              </a>
              <a class="btn btn-hero-ghost" href="#/tours">
                ${icon('compass', 18)} Explore city tours
              </a>
            </div>
          </div>
        </div>
      </div>

      <!-- Trust Metrics Bar -->
      <section class="welcome-metrics-strip">
        <div class="section-container">
          <div class="welcome-metrics-grid">
            <div class="welcome-metric-item">
              <span class="metric-num text-cyan">100%</span>
              <span class="metric-label">Hydro &amp; Wind Powered</span>
              <p class="metric-desc">Zero tailpipe emissions, charged from Ethiopia’s clean grid</p>
            </div>
            <div class="welcome-metric-item">
              <span class="metric-num">140+</span>
              <span class="metric-label">Neighbourhood Landmarks</span>
              <p class="metric-desc">Names, sefer directions, and Ge’ez pronunciations drivers know</p>
            </div>
            <div class="welcome-metric-item">
              <span class="metric-num">0%</span>
              <span class="metric-label">Surge Price Gouging</span>
              <p class="metric-desc">Transparent upfront ETB fares guaranteed before you ride</p>
            </div>
            <div class="welcome-metric-item">
              <span class="metric-num">24/7</span>
              <span class="metric-label">Safety &amp; SOS Desk</span>
              <p class="metric-desc">Verified drivers, live trip sharing, and encrypted pass codes</p>
            </div>
          </div>
        </div>
      </section>

      <!-- Core Pillars -->
      <section class="welcome-pillars-section">
        <div class="section-container">
          <div class="section-header-centered">
            <p class="section-eyebrow">The AddisGo Standard</p>
            <h2 class="section-headline">Four pillars that set us apart</h2>
            <p class="section-lead">Designed from the ground up for how Addis Ababa actually functions.</p>
          </div>

          <div class="pillars-grid">
            ${PILLARS.map((p) => `
              <article class="pillar-card">
                <div class="pillar-icon-box bg-cyan-soft">${icon(p.icon, 24)}</div>
                <span class="pillar-tag">${esc(p.tag)}</span>
                <h3>${esc(p.title)}</h3>
                <p>${esc(p.desc)}</p>
              </article>
            `).join('')}
          </div>
        </div>
      </section>

      <!-- How it Works 3 Steps -->
      <section class="welcome-how-section">
        <div class="section-container">
          <div class="section-header-centered">
            <p class="section-eyebrow">Simple &amp; Seamless</p>
            <h2 class="section-headline">How AddisGo works</h2>
            <p class="section-lead">From booking to arrival in three transparent steps.</p>
          </div>

          <div class="how-it-works-grid">
            ${HOW_IT_WORKS.map((h) => `
              <div class="how-step-card">
                <div class="how-step-badge">${esc(h.step)}</div>
                <div class="how-step-icon">${icon(h.icon, 22)}</div>
                <h3>${esc(h.title)}</h3>
                <p>${esc(h.desc)}</p>
              </div>
            `).join('')}
          </div>
        </div>
      </section>

      <!-- The Comparison Section -->
      <section class="welcome-compare-section">
        <div class="section-container">
          <div class="section-header-centered">
            <p class="section-eyebrow">The Difference</p>
            <h2 class="section-headline">The old street way vs. the AddisGo way</h2>
            <p class="section-lead">Why riders, locals, and visitors choose AddisGo every day.</p>
          </div>

          <div class="compare-grid">
            <div class="compare-card compare-old">
              <h3>Traditional taxi &amp; tour experience</h3>
              <ul class="compare-list">
                <li><span class="comp-cross">✕</span> Street-side price haggling at every stop</li>
                <li><span class="comp-cross">✕</span> Ambiguous directions that GPS struggles to find</li>
                <li><span class="comp-cross">✕</span> Older vehicles with high exhaust and noise pollution</li>
                <li><span class="comp-cross">✕</span> Unverified drivers and no paper trail or receipts</li>
                <li><span class="comp-cross">✕</span> Crowded tour buses with rushed itineraries</li>
              </ul>
            </div>

            <div class="compare-card compare-new">
              <div class="comp-head">
                <h3>With AddisGo</h3>
                <span class="badge badge-soft tone-green">Recommended</span>
              </div>
              <ul class="compare-list">
                <li><span class="comp-check">✓</span> Guaranteed upfront ETB fare before you confirm</li>
                <li><span class="comp-check">✓</span> 140+ real Ethiopian neighbourhood names taxi drivers know</li>
                <li><span class="comp-check">✓</span> Quiet, zero-tailpipe Electric E2 city cars</li>
                <li><span class="comp-check">✓</span> Operations-verified licences, plates and pass codes</li>
                <li><span class="comp-check">✓</span> Small-group intimate walks with vetted local hosts</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      <!-- FAQ Section -->
      <section class="welcome-faq-section">
        <div class="section-container">
          <div class="section-header-centered">
            <p class="section-eyebrow">Frequently Asked Questions</p>
            <h2 class="section-headline">Got questions? We have answers.</h2>
            <p class="section-lead">Everything you need to know about riding, pricing, and exploring with AddisGo.</p>
          </div>

          <div class="faq-grid">
            ${FAQS.map((faq) => `
              <div class="faq-card">
                <h3>${icon('info', 18)} ${esc(faq.q)}</h3>
                <p>${esc(faq.a)}</p>
              </div>
            `).join('')}
          </div>
        </div>
      </section>

      <!-- Bottom Callout -->
      <section class="section-cta">
        <div class="section-container cta-container">
          <div class="cta-content">
            <p class="section-eyebrow text-cyan">Ready to ride?</p>
            <h2 class="cta-title">Experience the calm way through Addis.</h2>
            <p class="cta-sub">Sign up in seconds, request an electric car, or discover hidden gems with a local guide.</p>
            <div class="cta-actions">
              <a class="btn btn-cyan btn-lg" href="${isAuthed ? '#/ride' : '#/register'}">
                ${isAuthed ? 'Book an electric ride' : 'Get started today'}
              </a>
              <a class="btn btn-ghost-light btn-lg" href="#/tours">View upcoming tours</a>
            </div>
          </div>
          <div class="cta-badge-art" aria-hidden="true">
            ${logoMark(90)}
          </div>
        </div>
      </section>
    </section>
  `;
}
