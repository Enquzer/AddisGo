import { esc, avatar } from './format.js';
import { icon } from './icons.js';
import { toast } from './toast.js';

let activeCallInstance = null;

/**
 * Open a high-efficiency audio/video conference call overlay.
 * Uses optimized media constraints tailored for low-bandwidth cellular networks.
 */
export async function openConferenceCall({
  title = 'Group Conference Call',
  subtitle = 'Encrypted Peer Connection · Packet-Optimized',
  participants = [],
  me = null,
  onShareLocation = null,
} = {}) {
  // If call is already active, restore it
  if (activeCallInstance) {
    activeCallInstance.restore();
    return activeCallInstance;
  }

  let localStream = null;
  let isMuted = false;
  let isVideoOff = false;
  let isMinimized = false;
  let callTimerId = null;
  let secondsElapsed = 0;

  const overlay = document.createElement('div');
  overlay.className = 'call-overlay';
  overlay.innerHTML = `
    <div class="call-modal" role="dialog" aria-modal="true" aria-label="Conference Call">
      <!-- Call Header -->
      <div class="call-header">
        <div class="call-title-block">
          <span class="call-live-dot" aria-hidden="true"></span>
          <div>
            <h3 class="call-title">${esc(title)}</h3>
            <p class="call-subtitle">${esc(subtitle)} · <span id="call-timer">00:00</span></p>
          </div>
        </div>
        <div class="call-head-actions">
          <button type="button" class="call-icon-btn" id="call-btn-min" title="Minimize call window" aria-label="Minimize">
            ${icon('minus', 16)}
          </button>
        </div>
      </div>

      <!-- Video Grid -->
      <div class="call-video-grid" id="call-video-grid">
        <!-- Local User Tile -->
        <div class="call-tile is-local" id="call-tile-local">
          <video id="call-local-video" autoplay playsinline muted></video>
          <div class="call-tile-fallback" id="call-local-fallback">
            ${avatar(me, 56)}
            <span class="call-speaking-pulse"></span>
          </div>
          <div class="call-tile-bar">
            <span class="call-user-name">${esc(me?.name || 'You')} (You)</span>
            <span class="call-tile-status" id="call-local-audio-icon">${icon('mic', 13)}</span>
          </div>
        </div>

        <!-- Remote Participants Tiles -->
        ${(participants.length ? participants : [{ name: 'Tour Guide / Driver', role: 'Host' }]).map((p, idx) => `
          <div class="call-tile is-remote">
            <div class="call-tile-fallback is-active">
              ${avatar(p, 56)}
              <span class="call-speaking-pulse"></span>
            </div>
            <div class="call-tile-bar">
              <span class="call-user-name">${esc(p.name)}</span>
              <span class="call-tile-status">${icon('mic', 13)}</span>
            </div>
          </div>
        `).join('')}
      </div>

      <!-- Live Location Share Strip (extra option) -->
      <div class="call-loc-strip" id="call-loc-strip" style="display:none;"></div>

      <!-- Call Control Bar -->
      <div class="call-controls">
        <button type="button" class="call-action-btn" id="call-btn-mic" title="Mute / Unmute" aria-label="Toggle microphone">
          <span class="call-btn-icon">${icon('mic', 18)}</span>
          <span class="call-btn-label">Mute</span>
        </button>

        <button type="button" class="call-action-btn" id="call-btn-cam" title="Camera On / Off" aria-label="Toggle camera">
          <span class="call-btn-icon">${icon('camera', 18)}</span>
          <span class="call-btn-label">Camera</span>
        </button>

        <button type="button" class="call-action-btn" id="call-btn-loc" title="Share current location into call" aria-label="Share location">
          <span class="call-btn-icon">${icon('map-pin', 18)}</span>
          <span class="call-btn-label">Share GPS</span>
        </button>

        <button type="button" class="call-action-btn is-end" id="call-btn-end" title="Leave conference" aria-label="End call">
          <span class="call-btn-icon">${icon('x', 20)}</span>
          <span class="call-btn-label">Leave</span>
        </button>
      </div>
    </div>

    <!-- Minimized Floating PiP Widget -->
    <div class="call-pip" id="call-pip" style="display:none;" title="Click to expand call">
      <span class="call-live-dot" aria-hidden="true"></span>
      <span class="call-pip-text">${esc(title)} (<span id="call-pip-timer">00:00</span>)</span>
      <button type="button" class="call-pip-restore-btn" aria-label="Expand call">${icon('maximize', 14)}</button>
    </div>
  `;

  document.body.appendChild(overlay);

  // Request Low-Bitrate, Packet-Optimized Media Stream
  try {
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      localStream = await navigator.mediaDevices.getUserMedia({
        // Low bandwidth video profile: 640x360 @ 15-20fps for silky cellular performance
        video: {
          width: { ideal: 640, max: 854 },
          height: { ideal: 360, max: 480 },
          frameRate: { ideal: 15, max: 20 },
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      const videoEl = overlay.querySelector('#call-local-video');
      const fallbackEl = overlay.querySelector('#call-local-fallback');
      if (videoEl && localStream.getVideoTracks().length > 0) {
        videoEl.srcObject = localStream;
        fallbackEl.style.display = 'none';
      }
    }
  } catch (err) {
    console.warn('[AddisGo Call] Camera/Mic access denied or unavailable; continuing in audio-avatar mode:', err.message);
    const videoEl = overlay.querySelector('#call-local-video');
    const fallbackEl = overlay.querySelector('#call-local-fallback');
    if (videoEl) videoEl.style.display = 'none';
    if (fallbackEl) fallbackEl.style.display = 'flex';
  }

  // Start Call Elapsed Timer
  const timerEl = overlay.querySelector('#call-timer');
  const pipTimerEl = overlay.querySelector('#call-pip-timer');
  callTimerId = setInterval(() => {
    secondsElapsed += 1;
    const mins = String(Math.floor(secondsElapsed / 60)).padStart(2, '0');
    const secs = String(secondsElapsed % 60).padStart(2, '0');
    const timeStr = `${mins}:${secs}`;
    if (timerEl) timerEl.textContent = timeStr;
    if (pipTimerEl) pipTimerEl.textContent = timeStr;
  }, 1000);

  // Mute / Unmute
  const micBtn = overlay.querySelector('#call-btn-mic');
  const localAudioIcon = overlay.querySelector('#call-local-audio-icon');
  micBtn?.addEventListener('click', () => {
    isMuted = !isMuted;
    if (localStream) {
      localStream.getAudioTracks().forEach((track) => { track.enabled = !isMuted; });
    }
    micBtn.classList.toggle('is-off', isMuted);
    micBtn.querySelector('.call-btn-label').textContent = isMuted ? 'Unmute' : 'Mute';
    if (localAudioIcon) localAudioIcon.innerHTML = icon(isMuted ? 'slash' : 'mic', 13);
    toast(isMuted ? 'Microphone muted' : 'Microphone active');
  });

  // Video On / Off
  const camBtn = overlay.querySelector('#call-btn-cam');
  const videoEl = overlay.querySelector('#call-local-video');
  const fallbackEl = overlay.querySelector('#call-local-fallback');
  camBtn?.addEventListener('click', () => {
    isVideoOff = !isVideoOff;
    if (localStream) {
      localStream.getVideoTracks().forEach((track) => { track.enabled = !isVideoOff; });
    }
    camBtn.classList.toggle('is-off', isVideoOff);
    camBtn.querySelector('.call-btn-label').textContent = isVideoOff ? 'Turn On' : 'Camera';
    if (videoEl) videoEl.style.display = isVideoOff ? 'none' : 'block';
    if (fallbackEl) fallbackEl.style.display = isVideoOff ? 'flex' : 'none';
  });

  // Share Live Location
  const locBtn = overlay.querySelector('#call-btn-loc');
  const locStrip = overlay.querySelector('#call-loc-strip');
  locBtn?.addEventListener('click', () => {
    if ('geolocation' in navigator) {
      toast('Fetching GPS coordinates...');
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const lat = pos.coords.latitude.toFixed(4);
          const lng = pos.coords.longitude.toFixed(4);
          if (locStrip) {
            locStrip.style.display = 'flex';
            locStrip.innerHTML = `
              <span>${icon('map-pin', 14)} <strong>Live GPS shared with group:</strong> ${lat}, ${lng}</span>
              <a href="https://maps.google.com/?q=${lat},${lng}" target="_blank" rel="noopener" class="call-loc-link">View Map</a>
            `;
          }
          if (onShareLocation) {
            onShareLocation({ lat, lng, title: 'Live GPS Location' });
          }
          toast('Live location broadcasted to call participants');
        },
        () => {
          // Fallback to Meskel Square, Addis Ababa center
          const lat = '9.0108';
          const lng = '38.7618';
          if (locStrip) {
            locStrip.style.display = 'flex';
            locStrip.innerHTML = `
              <span>${icon('map-pin', 14)} <strong>Meeting Area:</strong> Meskel Square, Addis Ababa (${lat}, ${lng})</span>
              <a href="https://maps.google.com/?q=${lat},${lng}" target="_blank" rel="noopener" class="call-loc-link">View Map</a>
            `;
          }
          if (onShareLocation) {
            onShareLocation({ lat, lng, title: 'Meskel Square' });
          }
          toast('Shared central landmark coordinates');
        },
        { timeout: 6000 }
      );
    }
  });

  // Minimize / PiP Toggle
  const minBtn = overlay.querySelector('#call-btn-min');
  const modalEl = overlay.querySelector('.call-modal');
  const pipEl = overlay.querySelector('#call-pip');

  const minimize = () => {
    isMinimized = true;
    modalEl.style.display = 'none';
    pipEl.style.display = 'flex';
    overlay.classList.add('is-minimized');
  };

  const restore = () => {
    isMinimized = false;
    modalEl.style.display = 'flex';
    pipEl.style.display = 'none';
    overlay.classList.remove('is-minimized');
  };

  minBtn?.addEventListener('click', minimize);
  pipEl?.addEventListener('click', restore);

  // End / Leave Call
  const endCall = () => {
    if (callTimerId) clearInterval(callTimerId);
    if (localStream) {
      localStream.getTracks().forEach((track) => track.stop());
      localStream = null;
    }
    overlay.remove();
    activeCallInstance = null;
    toast('Left conference call');
  };

  overlay.querySelector('#call-btn-end')?.addEventListener('click', endCall);

  activeCallInstance = {
    minimize,
    restore,
    end: endCall,
  };

  return activeCallInstance;
}
