import { icon, logoMark } from '../ui/icons.js';
import { esc } from '../ui/format.js';

export default async function renderLegal(view, ctx = {}) {
  // Determine active sub-tab from route or hash: 'terms', 'privacy', 'cookies', 'disclaimer'
  const currentPath = ctx.raw || '/terms';
  let activeTab = 'terms';
  if (currentPath.includes('privacy')) activeTab = 'privacy';
  else if (currentPath.includes('cookies')) activeTab = 'cookies';
  else if (currentPath.includes('legal') || currentPath.includes('disclaimer')) activeTab = 'disclaimer';

  const titles = {
    terms: 'Terms and Conditions · AddisGo',
    privacy: 'Privacy Policy & Global Data Rights · AddisGo',
    cookies: 'Cookie Rights & Tracking Policy · AddisGo',
    disclaimer: 'Legal Disclaimers & Safety Regulations · AddisGo',
  };
  document.title = titles[activeTab] || 'Legal & Compliance · AddisGo';

  view.innerHTML = `
    <section class="legal-page">
      <div class="legal-hero">
        <div class="section-container">
          <div class="legal-hero-inner">
            <span class="legal-badge">${icon('shield', 14)} Legal, Compliance &amp; Global Privacy</span>
            <h1 class="legal-title">Legal Terms &amp; Privacy Rights</h1>
            <p class="legal-subtitle">
              Transparent contracts, GDPR &amp; CCPA data protection, and international safety compliance for riders, drivers, and tour hosts worldwide.
            </p>
            <p class="legal-meta">Last Updated: October 2026 · Effective across Ethiopia &amp; International Jurisdictions</p>
          </div>
        </div>
      </div>

      <!-- Legal Navigation Tabs -->
      <nav class="legal-tabs-bar" aria-label="Legal Sections">
        <div class="section-container legal-tabs-container">
          <a href="#/terms" class="legal-tab-btn ${activeTab === 'terms' ? 'is-active' : ''}">
            ${icon('check-circle', 16)} Terms &amp; Conditions
          </a>
          <a href="#/privacy" class="legal-tab-btn ${activeTab === 'privacy' ? 'is-active' : ''}">
            ${icon('lock', 16)} Privacy Policy (GDPR/CCPA)
          </a>
          <a href="#/cookies" class="legal-tab-btn ${activeTab === 'cookies' ? 'is-active' : ''}">
            ${icon('shield', 16)} Cookie Rights &amp; Policy
          </a>
          <a href="#/legal" class="legal-tab-btn ${activeTab === 'disclaimer' ? 'is-active' : ''}">
            ${icon('info', 16)} Disclaimers &amp; Safety
          </a>
        </div>
      </nav>

      <!-- Main Legal Document Content Area -->
      <div class="section-container legal-body-layout">
        <aside class="legal-sidebar" aria-label="Document Outline">
          <div class="legal-outline-box">
            <h4>In this Document</h4>
            ${activeTab === 'terms' ? `
              <ul class="outline-list">
                <li><a href="#sec-t1">1. Scope of Technology Services</a></li>
                <li><a href="#sec-t2">2. User Eligibility &amp; Accounts</a></li>
                <li><a href="#sec-t3">3. Transparent ETB Fares &amp; Payments</a></li>
                <li><a href="#sec-t4">4. Cancellations &amp; Airport Wait Times</a></li>
                <li><a href="#sec-t5">5. Code of Conduct &amp; Safety Passes</a></li>
                <li><a href="#sec-t6">6. Limitation of Liability</a></li>
                <li><a href="#sec-t7">7. Governing Law &amp; Arbitration</a></li>
              </ul>
            ` : activeTab === 'privacy' ? `
              <ul class="outline-list">
                <li><a href="#sec-p1">1. Lawful Basis &amp; Principles</a></li>
                <li><a href="#sec-p2">2. Information We Collect</a></li>
                <li><a href="#sec-p3">3. Geolocation &amp; Privacy Shield</a></li>
                <li><a href="#sec-p4">4. Cross-Border Data Transfers</a></li>
                <li><a href="#sec-p5">5. Your GDPR &amp; CCPA Rights</a></li>
                <li><a href="#sec-p6">6. Data Retention &amp; Erasure</a></li>
              </ul>
            ` : activeTab === 'cookies' ? `
              <ul class="outline-list">
                <li><a href="#sec-c1">1. What Are Cookies?</a></li>
                <li><a href="#sec-c2">2. Cookies We Utilize</a></li>
                <li><a href="#sec-c3">3. Interactive Consent Controls</a></li>
                <li><a href="#sec-c4">4. Browser-Level Disabling</a></li>
              </ul>
            ` : `
              <ul class="outline-list">
                <li><a href="#sec-d1">1. Platform Intermediary Disclaimer</a></li>
                <li><a href="#sec-d2">2. Tour Host Independence</a></li>
                <li><a href="#sec-d3">3. 24/7 SOS &amp; Emergency Escalation</a></li>
                <li><a href="#sec-d4">4. Intellectual Property Rights</a></li>
              </ul>
            `}

            <div class="legal-support-card">
              <span class="support-title">${icon('mail', 14)} Legal &amp; DPO Inquiries</span>
              <p>Contact our Data Protection Officer:</p>
              <a href="mailto:legal@addisgo.et" class="text-link">legal@addisgo.et</a>
              <span class="support-hours">Addis Ababa, Ethiopia · Mon–Fri 8:30–17:30 EAT</span>
            </div>
          </div>
        </aside>

        <article class="legal-article" id="legal-article">
          ${activeTab === 'terms' ? renderTermsSection() : ''}
          ${activeTab === 'privacy' ? renderPrivacySection() : ''}
          ${activeTab === 'cookies' ? renderCookiesSection() : ''}
          ${activeTab === 'disclaimer' ? renderDisclaimerSection() : ''}
        </article>
      </div>
    </section>
  `;

  // Attach interactive cookie preference toggle logic if on cookie page
  if (activeTab === 'cookies') {
    bindCookiePreferences(view);
  }
}

function renderTermsSection() {
  return `
    <div class="legal-document-content">
      <div class="doc-header">
        <h2>Terms and Conditions of Service</h2>
        <span class="doc-ref">Agreement Version: 3.4 (Global Edition)</span>
      </div>

      <div class="alert-box alert-info">
        ${icon('info', 20)}
        <div>
          <strong>Summary of Key Protections:</strong> AddisGo operates an intermediary mobility and city guide platform. Fares are strictly upfront with no airport surge; users verify vehicles with confidential AG-XXXXXX safety codes; and all disputes are resolved under transparent Ethiopian and international arbitration principles.
        </div>
      </div>

      <section class="doc-section" id="sec-t1">
        <h3>1. Scope of Technology Platform Services</h3>
        <p>
          AddisGo ("AddisGo", "we", "us", or "the Platform") provides an intelligent software platform connecting registered passengers ("Riders") with verified independent electric transport providers ("Drivers") and vetted cultural guides ("Tour Hosts").
        </p>
        <p>
          <strong>Platform Status:</strong> AddisGo does not own transport vehicles or employ drivers as staff. AddisGo acts strictly as a technology intermediary providing dispatch, automated GPS estimation, bilingual Amharic wayfinding, and digital payment facilitation pursuant to the Ethiopian Commercial Code and international electronic commerce standards.
        </p>
      </section>

      <section class="doc-section" id="sec-t2">
        <h3>2. User Eligibility, Registration &amp; Account Security</h3>
        <p>
          You must be at least eighteen (18) years of age to establish an account. When registering, you warrant that all identification, phone number, and credential details provided are genuine and accurate.
        </p>
        <p>
          You are solely responsible for maintaining the confidentiality of your credentials. Any ride booked or group tour reserved under your account is your financial and contractual responsibility.
        </p>
      </section>

      <section class="doc-section" id="sec-t3">
        <h3>3. Transparent ETB Fares, No-Surge Guarantee &amp; Settlement</h3>
        <p>
          <strong>Upfront Fares:</strong> All ride estimates generated on AddisGo are displayed in Ethiopian Birr (ETB) before booking. The calculated upfront fare is definitive; drivers are legally prohibited from negotiating, demanding surcharges, or claiming street curb additions.
        </p>
        <p>
          <strong>Settlement Methods:</strong> Riders may pay via direct Telebirr integration, CBE Birr, debit cards, or verified cash payment directly to the driver upon destination arrival. Digital VAT receipts are instantly archived in your Trips history.
        </p>
      </section>

      <section class="doc-section" id="sec-t4">
        <h3>4. Cancellations, Flight Delay Protections &amp; Refunds</h3>
        <p>
          <strong>Standard City Rides:</strong> You may cancel a requested ride without penalty within 2 minutes of dispatch. If cancelled after an electric driver has navigated more than 1 km toward your pickup point, a standard cancellation fee of 50 ETB will be charged.
        </p>
        <p>
          <strong>Airport Dispatches:</strong> Bole International Airport bookings feature complimentary ET-flight delay monitoring and forty-five (45) minutes of free terminal waiting time after flight touchdown.
        </p>
        <p>
          <strong>City Tours:</strong> Cancellations made more than two (2) hours prior to tour start time are refunded in full.
        </p>
      </section>

      <section class="doc-section" id="sec-t5">
        <h3>5. Safety Codes, Confidentiality &amp; Code of Conduct</h3>
        <p>
          To protect foreign and local users alike, personal telephone numbers are never shown to drivers or co-riders. At pickup, riders provide their dynamic six-character <strong>Safety Pass (e.g., AG-749210)</strong>. Drivers confirm this code in-app before opening vehicle doors.
        </p>
        <p>
          Zero tolerance is maintained for harassment, intoxication, offensive language, or dangerous requests. Any breach results in immediate permanent ban and referral to law enforcement.
        </p>
      </section>

      <section class="doc-section" id="sec-t6">
        <h3>6. Limitation of Liability &amp; Force Majeure</h3>
        <p>
          To the maximum extent permitted by applicable law, AddisGo is not liable for indirect, incidental, punitive, or consequential damages resulting from road conditions, traffic delays, vehicle mechanical issues, or actions of third-party drivers or hosts.
        </p>
        <p>
          In all events, AddisGo's aggregate cumulative liability for any claim arising out of your use of the platform shall not exceed the total amount paid by you for the specific trip or tour in dispute.
        </p>
      </section>

      <section class="doc-section" id="sec-t7">
        <h3>7. Governing Law, International Jurisdiction &amp; Arbitration</h3>
        <p>
          These Terms are governed by and construed in accordance with the laws of the Federal Democratic Republic of Ethiopia.
        </p>
        <p>
          Any dispute, controversy, or claim arising out of or relating to this contract shall be settled amicably through our 24/7 Operations Desk. Failing amicable resolution within thirty (30) days, disputes shall be finally settled under the Rules of Arbitration of the Addis Ababa Chamber of Commerce and Sectoral Associations (AACCSA) or UNCITRAL Arbitration Rules by one arbitrator appointed in accordance with said rules.
        </p>
      </section>
    </div>
  `;
}

function renderPrivacySection() {
  return `
    <div class="legal-document-content">
      <div class="doc-header">
        <h2>Global Privacy Policy &amp; Data Subject Rights</h2>
        <span class="doc-ref">Compliant with GDPR (EU/UK), CCPA/CPRA (California), &amp; Ethiopian Data Protection Directives</span>
      </div>

      <div class="alert-box alert-green">
        ${icon('shield', 20)}
        <div>
          <strong>Privacy By Design:</strong> We collect only what is strictly necessary to operate quiet electric rides and curated tours. We never sell your personal information, never track your location when the app is closed, and never expose your personal phone number.
        </div>
      </div>

      <section class="doc-section" id="sec-p1">
        <h3>1. Lawful Basis for Processing Personal Data</h3>
        <p>Under GDPR Article 6 and international data privacy frameworks, AddisGo processes your personal data under the following legal bases:</p>
        <ul>
          <li><strong>Contractual Necessity:</strong> To process ride requests, assign nearby electric drivers, and confirm tour bookings.</li>
          <li><strong>Explicit Consent:</strong> For real-time GPS coordinate access while navigating to tour meeting points or tracking an assigned driver.</li>
          <li><strong>Legal Obligation:</strong> For maintaining digital VAT tax receipts under Ethiopian Revenue &amp; Customs regulations.</li>
          <li><strong>Legitimate Interest:</strong> For platform fraud detection, driver verification, and 24/7 SOS safety desk monitoring.</li>
        </ul>
      </section>

      <section class="doc-section" id="sec-p2">
        <h3>2. What Data We Collect &amp; How It Is Used</h3>
        <table class="legal-data-table">
          <thead>
            <tr>
              <th>Data Category</th>
              <th>Specific Items</th>
              <th>Purpose &amp; Retention</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>Identity Data</strong></td>
              <td>Full name, email address, encrypted password hash</td>
              <td>Account creation &amp; booking receipts. Retained until account closure.</td>
            </tr>
            <tr>
              <td><strong>Geolocation</strong></td>
              <td>Pickup &amp; destination coordinates during active ride</td>
              <td>Route calculation &amp; live driver ETA. High-precision GPS is purged after 90 days.</td>
            </tr>
            <tr>
              <td><strong>Financial</strong></td>
              <td>Payment method tokens, transaction sums (ETB)</td>
              <td>Billing &amp; tax audits. Retained for 7 years per statutory regulation.</td>
            </tr>
            <tr>
              <td><strong>Social &amp; Tour Chat</strong></td>
              <td>Group tour chat messages &amp; driver-rider notes</td>
              <td>Group coordination. Messages archived 30 days after tour completion.</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section class="doc-section" id="sec-p3">
        <h3>3. Geolocation &amp; The Phone Number Privacy Shield</h3>
        <p>
          Unlike legacy dispatch systems that broadcast your personal cell phone number to drivers, AddisGo utilizes an in-app encrypted <strong>Safety Pass Code (AG-XXXXXX)</strong>. Drivers communicate with riders solely through our ephemeral in-app messaging corridor.
        </p>
        <p>
          Geolocation is captured exclusively in foreground when searching landmarks or actively tracking a ride. AddisGo does not run continuous background location trackers.
        </p>
      </section>

      <section class="doc-section" id="sec-p4">
        <h3>4. International Data Transfers &amp; Encryption Standards</h3>
        <p>
          All communications between your browser, our API endpoints, and database clusters are encrypted in transit using Transport Layer Security (TLS 1.3 / AES-256).
        </p>
        <p>
          For foreign nationals visiting Ethiopia, data is transferred under Standard Contractual Clauses (SCCs) ensuring technical safeguards benchmarked against EU and international adequacy standards.
        </p>
      </section>

      <section class="doc-section" id="sec-p5">
        <h3>5. Your Global Rights (GDPR, CCPA &amp; International)</h3>
        <p>Regardless of your country of citizenship, AddisGo extends comprehensive privacy rights to all users:</p>
        <div class="rights-cards-grid">
          <div class="right-card">
            <h4>${icon('eye', 16)} Right of Access</h4>
            <p>Request an export of all personal profiles, bookings, and chat transcripts associated with your identity.</p>
          </div>
          <div class="right-card">
            <h4>${icon('edit', 16)} Right to Rectify</h4>
            <p>Update or correct incomplete or outdated personal information anytime from your Profile page.</p>
          </div>
          <div class="right-card">
            <h4>${icon('trash', 16)} Right to Erasure</h4>
            <p>Request complete deletion of your account and identification records ("Right to be Forgotten").</p>
          </div>
          <div class="right-card">
            <h4>${icon('shield', 16)} Do Not Sell My Info</h4>
            <p>AddisGo does not sell, rent, or trade your personal data to data brokers or advertising exchanges.</p>
          </div>
        </div>
        <p class="mt-4">
          To exercise any of these rights, email our Data Protection Officer at <a href="mailto:privacy@addisgo.et" class="text-link">privacy@addisgo.et</a>. Requests are fulfilled free of charge within thirty (30) days.
        </p>
      </section>

      <section class="doc-section" id="sec-p6">
        <h3>6. Security Breach Notifications</h3>
        <p>
          In the event of a verified data incident impacting personal information, AddisGo maintains strict protocols to notify affected users and competent regulatory authorities within 72 hours of becoming aware of the breach.
        </p>
      </section>
    </div>
  `;
}

function renderCookiesSection() {
  const currentConsent = localStorage.getItem('addisgo_cookie_consent') || 'all';

  return `
    <div class="legal-document-content">
      <div class="doc-header">
        <h2>Cookie Rights &amp; Local Storage Policy</h2>
        <span class="doc-ref">Interactive Cookie Consent &amp; Preference Manager</span>
      </div>

      <div class="alert-box alert-info">
        ${icon('info', 20)}
        <div>
          <strong>Transparent Tracking:</strong> We use strictly necessary cookies to keep you safely signed in and functional local storage to remember your preferred landmark drop points. We do not deploy third-party advertising cookies.
        </div>
      </div>

      <section class="doc-section" id="sec-c1">
        <h3>1. What Are Cookies and Local Storage?</h3>
        <p>
          Cookies are small text files stored on your device that enable websites to recognize your session. LocalStorage is modern browser storage that allows preferences (such as your preferred map zoom or language) to persist without transmitting data to tracking servers.
        </p>
      </section>

      <section class="doc-section" id="sec-c2">
        <h3>2. Types of Cookies Used on AddisGo</h3>
        <div class="cookie-types-list">
          <div class="cookie-type-item">
            <div class="cookie-type-head">
              <strong>Strictly Necessary Cookies</strong>
              <span class="badge badge-soft tone-green">Always Active</span>
            </div>
            <p>
              Essential for secure authentication, session encryption (<code>addisgo_jwt</code>), rate-limiting security headers, and cross-site request forgery (CSRF) protection. The platform cannot function without these cookies.
            </p>
          </div>

          <div class="cookie-type-item">
            <div class="cookie-type-head">
              <strong>Functional &amp; Preference Storage</strong>
              <span class="badge badge-soft tone-cyan">Customizable</span>
            </div>
            <p>
              Stores your chosen local neighbourhood landmarks (e.g. Bole Japan, Kazanchis), audio pronunciation volume, and recent search origins to speed up booking.
            </p>
          </div>

          <div class="cookie-type-item">
            <div class="cookie-type-head">
              <strong>Performance &amp; Diagnostics</strong>
              <span class="badge badge-soft tone-amber">Customizable</span>
            </div>
            <p>
              Anonymized latency metrics on map tile loading and road route calculations to ensure smooth operation during peak Addis Ababa traffic hours.
            </p>
          </div>
        </div>
      </section>

      <section class="doc-section" id="sec-c3">
        <h3>3. Interactive Cookie Preferences Manager</h3>
        <p>You can manage and update your cookie preferences for this browser below:</p>

        <div class="cookie-manager-card">
          <div class="cookie-toggle-row">
            <div>
              <strong>Strictly Necessary Cookies</strong>
              <small>Authentication, CSRF, and security passes.</small>
            </div>
            <span class="cookie-status-locked">Required</span>
          </div>

          <div class="cookie-toggle-row">
            <div>
              <strong>Functional &amp; Landmark Storage</strong>
              <small>Remembers favourite drops and Ge'ez phonetic settings.</small>
            </div>
            <label class="switch-toggle">
              <input type="checkbox" id="pref-functional" ${currentConsent !== 'minimal' ? 'checked' : ''} />
              <span class="slider-toggle"></span>
            </label>
          </div>

          <div class="cookie-toggle-row">
            <div>
              <strong>Performance Diagnostics</strong>
              <small>Aggregated latency and route loading diagnostics.</small>
            </div>
            <label class="switch-toggle">
              <input type="checkbox" id="pref-performance" ${currentConsent === 'all' ? 'checked' : ''} />
              <span class="slider-toggle"></span>
            </label>
          </div>

          <div class="cookie-manager-actions">
            <button type="button" class="btn btn-primary" id="btn-save-cookie-prefs">
              ${icon('check', 14)} Save Cookie Preferences
            </button>
            <button type="button" class="btn btn-ghost" id="btn-accept-all-cookies">
              Accept All Cookies
            </button>
          </div>
          <span class="cookie-saved-msg" id="cookie-saved-msg" hidden>✓ Preferences successfully saved.</span>
        </div>
      </section>

      <section class="doc-section" id="sec-c4">
        <h3>4. How to Manage Cookies via Your Browser</h3>
        <p>
          You may configure your browser (Chrome, Safari, Edge, Firefox) to block or delete all cookies. Note that blocking essential cookies will prevent you from signing in and booking rides.
        </p>
      </section>
    </div>
  `;
}

function renderDisclaimerSection() {
  return `
    <div class="legal-document-content">
      <div class="doc-header">
        <h2>Legal Disclaimers, Transport Regulations &amp; Safety Desk</h2>
        <span class="doc-ref">Regulatory Transparency and Intermediary Declarations</span>
      </div>

      <div class="alert-box alert-amber">
        ${icon('shield', 20)}
        <div>
          <strong>Regulatory Compliance:</strong> AddisGo complies with Ethiopian Transport Authority standards, Federal Transport Directives, and consumer protection regulations. All vehicle operators undergo documentation audits before platform access is granted.
        </div>
      </div>

      <section class="doc-section" id="sec-d1">
        <h3>1. Platform Intermediary &amp; Independent Contractor Status</h3>
        <p>
          AddisGo operates solely as an application software provider. Drivers operating vehicles on the platform are independent owner-operators or commercial fleet partners. They are not agents, franchisees, or employees of AddisGo.
        </p>
        <p>
          Tour Hosts offering city tours, culinary walks, and hikes are independent licensed local guides and cultural storytellers.
        </p>
      </section>

      <section class="doc-section" id="sec-d2">
        <h3>2. Tour Activities &amp; Assumption of Risk</h3>
        <p>
          City walking tours (such as Entoto Ridge forest trails or Merkato spice walks) involve physical activity in urban and natural environments. Participants acknowledge that Addis Ababa sits at an elevation of approximately 2,355 meters (7,726 ft).
        </p>
        <p>
          Participants assume responsibility for assessing personal fitness, hydration, and medical capability. Tour Hosts carry first-aid gear and coordinate with the 24/7 AddisGo Safety Desk.
        </p>
      </section>

      <section class="doc-section" id="sec-d3">
        <h3>3. 24/7 SOS Desk &amp; Emergency Escalation Protocol</h3>
        <p>
          AddisGo provides an in-app <strong>SOS Hotline</strong> and incident reporting button on every active ride and tour. When triggered:
        </p>
        <ul>
          <li>Our dedicated Operations Team in Addis Ababa receives instant high-priority notification with your live coordinates.</li>
          <li>Our desk immediately contacts your verified driver or host.</li>
          <li>If necessary, direct escalation is initiated with the Ethiopian Federal Police Emergency Service (<strong>991</strong>) and Ambulance Dispatch (<strong>907</strong>).</li>
        </ul>
      </section>

      <section class="doc-section" id="sec-d4">
        <h3>4. Intellectual Property &amp; Landmark Directory Rights</h3>
        <p>
          The AddisGo logo, platform UI design, interactive flip phone layout, Ge'ez phonetic neighbourhood index, and proprietary mapping assets are the intellectual property of AddisGo Ltd.
        </p>
        <p>
          Unauthorised scraping, reproduction, or reverse engineering of the landmark database or platform code is strictly prohibited.
        </p>
      </section>
    </div>
  `;
}

function bindCookiePreferences(view) {
  const saveBtn = view.querySelector('#btn-save-cookie-prefs');
  const acceptAllBtn = view.querySelector('#btn-accept-all-cookies');
  const perfBox = view.querySelector('#pref-performance');
  const funcBox = view.querySelector('#pref-functional');
  const savedMsg = view.querySelector('#cookie-saved-msg');

  if (saveBtn) {
    saveBtn.addEventListener('click', () => {
      const mode = perfBox?.checked ? 'all' : funcBox?.checked ? 'functional' : 'minimal';
      localStorage.setItem('addisgo_cookie_consent', mode);
      localStorage.setItem('addisgo_cookie_consent_time', new Date().toISOString());
      if (savedMsg) {
        savedMsg.hidden = false;
        setTimeout(() => { savedMsg.hidden = true; }, 3000);
      }
      hideCookieBanner();
    });
  }

  if (acceptAllBtn) {
    acceptAllBtn.addEventListener('click', () => {
      if (perfBox) perfBox.checked = true;
      if (funcBox) funcBox.checked = true;
      localStorage.setItem('addisgo_cookie_consent', 'all');
      localStorage.setItem('addisgo_cookie_consent_time', new Date().toISOString());
      if (savedMsg) {
        savedMsg.hidden = false;
        setTimeout(() => { savedMsg.hidden = true; }, 3000);
      }
      hideCookieBanner();
    });
  }
}

export function hideCookieBanner() {
  const banner = document.getElementById('cookie-consent-banner');
  if (banner) {
    banner.style.opacity = '0';
    setTimeout(() => banner.remove(), 300);
  }
}
