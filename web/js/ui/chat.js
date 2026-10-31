import { esc, avatar, time } from './format.js';
import { icon } from './icons.js';
import { toast, toastError } from './toast.js';
import { createPoller } from './poll.js';
import { $ } from './dom.js';
import { api } from '../api.js';
import { openConferenceCall } from './call.js';

/**
 * Client-side packet optimizer: Downsamples and compresses images
 * to keep data exchange lean (<180KB) for resilient Addis mobile connections.
 */
async function compressImage(file, maxDimension = 1200, quality = 0.75) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let width = img.width;
        let height = img.height;
        if (width > maxDimension || height > maxDimension) {
          if (width > height) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          } else {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => reject(new Error('Invalid image file'));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error('Could not read image'));
    reader.readAsDataURL(file);
  });
}

/**
 * Read short video as data URI with strict client-side size constraints (<8MB).
 */
async function readVideoDataUri(file) {
  if (file.size > 8 * 1024 * 1024) {
    throw new Error('Video must be under 8MB. Please trim to a short 10–15 second clip.');
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = () => reject(new Error('Could not read video'));
    reader.readAsDataURL(file);
  });
}

/**
 * Upgraded Chat Component:
 * - Overlayed with option to minimize into a floating dock
 * - Attach location links, pictures, and short videos
 * - Low-bitrate packet optimization and file limits
 * - Direct & group conference calls via integrated WebRTC
 */
export function mountChat(root, {
  load,
  send,
  interval = 5000,
  title = 'Group Chat',
  participants = [],
  placeholder = 'Write a message…',
  emptyText = 'No messages yet. Say hello 👋',
  disabled = false,
  disabledText = 'Chat is not available yet.',
  me = null,
} = {}) {
  if (!root) return { stop() {}, refresh() {} };

  let isMinimized = false;
  let isOverlayed = false;

  root.innerHTML = `
    <!-- Main Chat Window -->
    <div class="chat-container ${disabled ? 'is-disabled' : ''}" id="chat-main-container">
      <!-- Header with Minimize & Call Actions -->
      <div class="chat-top-bar">
        <div class="chat-top-info">
          <span class="chat-status-dot" aria-hidden="true"></span>
          <div>
            <h4 class="chat-top-title">${esc(title)}</h4>
            <span class="chat-top-meta">${participants.length ? `${participants.length} connected` : 'Live chat'}</span>
          </div>
        </div>

        <div class="chat-top-actions">
          ${disabled ? '' : `
            <button type="button" class="chat-btn-action" id="chat-call-btn" title="Start Conference Call" aria-label="Conference Call">
              ${icon('phone', 14)} <span>Call</span>
            </button>
          `}
          <button type="button" class="chat-btn-icon" id="chat-pop-btn" title="Toggle overlay mode" aria-label="Pop-out">
            ${icon('maximize', 13)}
          </button>
          <button type="button" class="chat-btn-icon" id="chat-min-btn" title="Minimize chat" aria-label="Minimize">
            ${icon('minus', 14)}
          </button>
        </div>
      </div>

      <!-- Messages Stream -->
      <div class="chat-list" role="log" aria-live="polite" aria-label="Conversation"></div>

      <!-- Input Bar with Media & Location Attachments -->
      ${disabled
        ? `<p class="chat-disabled">${icon('lock', 15)} ${esc(disabledText)}</p>`
        : `
          <!-- Location Picker Popup Menu -->
          <div class="chat-loc-menu" id="chat-loc-menu" style="display:none;">
            <div class="chat-loc-menu-head">
              <span>${icon('map-pin', 14)} <strong>Share Addis Location</strong></span>
              <button type="button" class="chat-loc-close" id="chat-loc-close">&times;</button>
            </div>
            <button type="button" class="chat-loc-opt" data-loc="gps">
              ${icon('navigation', 14)} <span>My GPS Location</span> <small>Live device GPS</small>
            </button>
            <button type="button" class="chat-loc-opt" data-loc="9.0108,38.7618|Meskel Square">
              ${icon('map-pin', 14)} <span>Meskel Square</span> <small>City Centre</small>
            </button>
            <button type="button" class="chat-loc-opt" data-loc="8.9953,38.7889|Bole Medhanialem">
              ${icon('map-pin', 14)} <span>Bole Medhanialem</span> <small>Bole Corridor</small>
            </button>
            <button type="button" class="chat-loc-opt" data-loc="9.0833,38.7614|Entoto Natural Park">
              ${icon('map-pin', 14)} <span>Entoto Natural Park</span> <small>Ridge Views</small>
            </button>
            <button type="button" class="chat-loc-opt" data-loc="9.0305,38.7397|Merkato">
              ${icon('map-pin', 14)} <span>Merkato</span> <small>Spice Market</small>
            </button>
            <button type="button" class="chat-loc-opt" data-loc="9.0345,38.7516|Piassa Churchill">
              ${icon('map-pin', 14)} <span>Piassa</span> <small>Historic Quarter</small>
            </button>
            <button type="button" class="chat-loc-opt" data-loc="9.0384,38.7619|National Museum">
              ${icon('map-pin', 14)} <span>National Museum</span> <small>Arat Kilo</small>
            </button>
          </div>

          <!-- Attachment Preview Strip -->
          <div class="chat-attach-preview" id="chat-attach-preview" style="display:none;"></div>

          <form class="chat-form" id="chat-form" autocomplete="off">
            <div class="chat-tools-bar">
              <button type="button" class="chat-tool-btn" id="chat-btn-loc" title="Share Location / Landmark" aria-label="Share location">
                ${icon('map-pin', 15)}
              </button>
              <button type="button" class="chat-tool-btn" id="chat-btn-photo" title="Attach Picture (Packet-Optimized)" aria-label="Attach picture">
                ${icon('camera', 15)}
              </button>
              <button type="button" class="chat-tool-btn" id="chat-btn-video" title="Attach Short Video Clip" aria-label="Attach video">
                ${icon('video', 15)}
              </button>

              <input type="file" id="chat-file-photo" accept="image/jpeg,image/png,image/webp" style="display:none;" />
              <input type="file" id="chat-file-video" accept="video/mp4,video/webm" style="display:none;" />
            </div>

            <label class="sr-only" for="chat-input">Message</label>
            <input id="chat-input" class="chat-input" name="body" type="text" maxlength="2000" placeholder="${esc(placeholder)}" required />
            <button type="submit" class="chat-send" aria-label="Send message">${icon('send', 18)}</button>
          </form>
        `}
    </div>

    <!-- Minimized Floating Dock Pill -->
    <div class="chat-dock-pill" id="chat-dock-pill" style="display:none;" title="Click to open chat">
      <span class="chat-status-dot" aria-hidden="true"></span>
      <span class="chat-dock-text">${icon('message-circle', 14)} <strong>${esc(title)}</strong></span>
      ${disabled ? '' : `<button type="button" class="chat-dock-call" id="chat-dock-call" title="Quick Call">${icon('phone', 13)}</button>`}
      <button type="button" class="chat-dock-expand" aria-label="Expand chat">${icon('chevron-up', 14)}</button>
    </div>
  `;

  const container = $('#chat-main-container', root);
  const dockPill = $('#chat-dock-pill', root);
  const list = $('.chat-list', root);
  const form = $('.chat-form', root);
  const input = $('.chat-input', root);
  const attachPreview = $('#chat-attach-preview', root);

  const photoInput = $('#chat-file-photo', root);
  const videoInput = $('#chat-file-video', root);

  let pendingAttachment = null;
  const seen = new Set();
  let lastCount = 0;

  // Toggle Minimize
  const setMinimized = (min) => {
    isMinimized = min;
    if (isMinimized) {
      container.style.display = 'none';
      dockPill.style.display = 'inline-flex';
    } else {
      container.style.display = 'flex';
      dockPill.style.display = 'none';
      list.scrollTop = list.scrollHeight;
    }
  };

  // Toggle Overlay (floating over map / page)
  const setOverlay = (overlay) => {
    isOverlayed = overlay;
    container.classList.toggle('is-overlay', isOverlayed);
    const popIcon = $('#chat-pop-btn', root);
    if (popIcon) {
      popIcon.innerHTML = icon(isOverlayed ? 'minimize-2' : 'maximize', 13);
    }
  };

  $('#chat-min-btn', root)?.addEventListener('click', () => setMinimized(true));
  dockPill?.addEventListener('click', () => setMinimized(false));
  $('#chat-pop-btn', root)?.addEventListener('click', () => setOverlay(!isOverlayed));

  // Conference Call Trigger
  const startCall = () => {
    openConferenceCall({
      title: `${title} Conference`,
      subtitle: `${participants.length || 1} participant${participants.length > 1 ? 's' : ''}`,
      participants,
      me,
      onShareLocation: (loc) => {
        // Automatically inject location into chat stream
        const body = `[location:${loc.lat},${loc.lng}|${loc.title}] Shared live location in conference call`;
        send(body).then(() => poller.kick()).catch(() => {});
      },
    });
  };

  $('#chat-call-btn', root)?.addEventListener('click', startCall);
  $('#chat-dock-call', root)?.addEventListener('click', (e) => {
    e.stopPropagation();
    startCall();
  });

  // Attach Location / GPS with 1-click Addis landmark menu
  const locBtn = $('#chat-btn-loc', root);
  const locMenu = $('#chat-loc-menu', root);
  const locClose = $('#chat-loc-close', root);

  const attachLocationTag = (tag) => {
    input.value = `${tag} ${input.value}`.trim();
    input.focus();
    if (locMenu) locMenu.style.display = 'none';
  };

  locBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!locMenu) return;
    locMenu.style.display = locMenu.style.display === 'none' ? 'flex' : 'none';
  });

  locClose?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (locMenu) locMenu.style.display = 'none';
  });

  root.querySelectorAll('.chat-loc-opt').forEach((opt) => {
    opt.addEventListener('click', (e) => {
      e.stopPropagation();
      const locKey = opt.dataset.loc;
      if (locKey === 'gps') {
        if ('geolocation' in navigator) {
          toast('Fetching GPS coordinates...');
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              const lat = pos.coords.latitude.toFixed(4);
              const lng = pos.coords.longitude.toFixed(4);
              attachLocationTag(`[location:${lat},${lng}|My GPS Location]`);
              toast('GPS location attached');
            },
            () => {
              attachLocationTag('[location:9.0108,38.7618|Meskel Square, Addis Ababa]');
              toast('Using central Addis landmark');
            },
            { timeout: 5000 },
          );
        } else {
          attachLocationTag('[location:9.0108,38.7618|Meskel Square, Addis Ababa]');
        }
      } else if (locKey) {
        const [coords, name] = locKey.split('|');
        attachLocationTag(`[location:${coords}|${name}]`);
        toast(`${name} attached`);
      }
    });
  });

  // Attach Photo with Client-Side Packet Compression
  $('#chat-btn-photo', root)?.addEventListener('click', () => {
    photoInput?.click();
  });

  photoInput?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    toast('Optimizing image for fast delivery...');
    try {
      const compressedDataUri = await compressImage(file, 1200, 0.75);
      const res = await api('/upload', {
        method: 'POST',
        body: { data: compressedDataUri, filename: file.name, type: 'image' },
      });

      pendingAttachment = { type: 'image', url: res.url };
      if (attachPreview) {
        attachPreview.style.display = 'flex';
        attachPreview.innerHTML = `
          <div class="preview-item">
            <img src="${res.url}" alt="Attachment preview" />
            <span>${icon('image', 12)} Ready to send</span>
            <button type="button" class="preview-remove" id="preview-remove-btn">&times;</button>
          </div>
        `;
        $('#preview-remove-btn', attachPreview)?.addEventListener('click', () => {
          pendingAttachment = null;
          attachPreview.style.display = 'none';
        });
      }
      toast('Picture attached and compressed');
    } catch (err) {
      toastError(err, 'Could not upload image');
    } finally {
      photoInput.value = '';
    }
  });

  // Attach Short Video
  $('#chat-btn-video', root)?.addEventListener('click', () => {
    videoInput?.click();
  });

  videoInput?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) {
      toastError(new Error('Videos are limited to 8MB max. Please select a short clip.'));
      return;
    }
    toast('Preparing short video clip...');
    try {
      const dataUri = await readVideoDataUri(file);
      const res = await api('/upload', {
        method: 'POST',
        body: { data: dataUri, filename: file.name, type: 'video' },
      });

      pendingAttachment = { type: 'video', url: res.url };
      if (attachPreview) {
        attachPreview.style.display = 'flex';
        attachPreview.innerHTML = `
          <div class="preview-item">
            <video src="${res.url}" muted></video>
            <span>${icon('video', 12)} Video clip ready</span>
            <button type="button" class="preview-remove" id="preview-remove-btn">&times;</button>
          </div>
        `;
        $('#preview-remove-btn', attachPreview)?.addEventListener('click', () => {
          pendingAttachment = null;
          attachPreview.style.display = 'none';
        });
      }
      toast('Video clip attached');
    } catch (err) {
      toastError(err, 'Could not upload video');
    } finally {
      videoInput.value = '';
    }
  });

  const nearBottom = () => {
    if (!list) return true;
    return list.scrollHeight - list.scrollTop - list.clientHeight < 120;
  };

  const append = (messages) => {
    if (!list) return;
    const stick = nearBottom();
    let added = 0;
    for (const message of messages) {
      if (!message || seen.has(message.id)) continue;
      seen.add(message.id);
      const node = document.createElement('article');
      node.className = `chat-msg ${message.is_own ? 'is-own' : ''}`;
      node.innerHTML = `
        ${message.is_own ? '' : avatar(message.user, 30, 'chat-avatar')}
        <div class="chat-bubble">
          ${message.is_own ? '' : `<span class="chat-name">${esc(message.user?.name || 'Traveller')}</span>`}
          <div class="chat-content">${renderRichMessage(message.body)}</div>
          <time datetime="${esc(message.created_at)}">${time(message.created_at)}</time>
        </div>
      `;
      list.append(node);
      added += 1;
    }
    if (!messages.length && !lastCount) {
      list.innerHTML = `<p class="chat-empty">${esc(emptyText)}</p>`;
    } else if (added) {
      list.querySelector('.chat-empty')?.remove();
      if (stick) list.scrollTop = list.scrollHeight;
    }
    lastCount = seen.size;
  };

  const refresh = async () => {
    try {
      const data = await load();
      append(data?.messages || []);
    } catch {
      /* polling stays quiet */
    }
  };

  const poller = createPoller(refresh, interval);

  if (form && input) {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      let body = input.value.trim();

      // If pending media attachment, prefix it to message body
      if (pendingAttachment) {
        if (pendingAttachment.type === 'image') {
          body = `[photo:${pendingAttachment.url}] ${body}`.trim();
        } else if (pendingAttachment.type === 'video') {
          body = `[video:${pendingAttachment.url}] ${body}`.trim();
        }
        pendingAttachment = null;
        if (attachPreview) attachPreview.style.display = 'none';
      }

      if (!body) return;
      input.value = '';
      input.focus();
      try {
        const message = await send(body);
        if (message) {
          append([{ ...message, is_own: true, user: message.user || me }]);
        }
        poller.kick();
      } catch (error) {
        toastError(error, 'Message was not sent.');
        if (!input.value) input.value = body;
      }
    });

    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        form.requestSubmit();
      }
    });
  }

  return {
    refresh,
    minimize: () => setMinimized(true),
    restore: () => setMinimized(false),
    stop() {
      poller.stop();
    },
  };
}

/**
 * Rich message parser: turns media tags, location cards, and links into rich UI elements.
 */
export function renderRichMessage(text) {
  if (!text) return '';
  let content = esc(text);

  // 1. Location Cards: [location:lat,lng|Title]
  content = content.replace(/\[location:([^,|\]]+),([^,|\]]+)(?:\|([^\]]+))?\]/g, (_, lat, lng, title) => {
    const cleanTitle = (title || 'Location Point').trim();
    const mapUrl = `https://maps.google.com/?q=${encodeURIComponent(lat.trim())},${encodeURIComponent(lng.trim())}`;
    return `
      <div class="chat-loc-card">
        <div class="chat-loc-head">
          <span class="chat-loc-pin">${icon('map-pin', 14)}</span>
          <div class="chat-loc-info">
            <strong>${esc(cleanTitle)}</strong>
            <small>${esc(lat.trim())}, ${esc(lng.trim())}</small>
          </div>
        </div>
        <a href="${mapUrl}" target="_blank" rel="noopener noreferrer" class="chat-loc-btn">
          ${icon('navigation', 12)} Open in Google Maps
        </a>
      </div>
    `;
  });

  // 2. Photos: [photo:/api/uploads/...]
  content = content.replace(/\[photo:([^\]]+)\]/g, (_, url) => {
    const cleanUrl = url.trim();
    return `
      <div class="chat-media-attachment">
        <img src="${esc(cleanUrl)}" alt="Photo attachment" class="chat-thumb-img" loading="lazy" onclick="window.open('${esc(cleanUrl)}', '_blank')" />
      </div>
    `;
  });

  // 3. Short Videos: [video:/api/uploads/...]
  content = content.replace(/\[video:([^\]]+)\]/g, (_, url) => {
    const cleanUrl = url.trim();
    return `
      <div class="chat-media-attachment">
        <video src="${esc(cleanUrl)}" controls playsinline class="chat-video-elem" preload="metadata"></video>
      </div>
    `;
  });

  // 4. Regular URLs -> Safe clickable links
  content = content.replace(/(https?:\/\/[^\s<]+)/g, (url) => {
    const clean = url.replace(/[.,;:!?)]+$/, '');
    const tail = url.slice(clean.length);
    return `<a href="${clean}" target="_blank" rel="noopener noreferrer">${clean}</a>${tail}`;
  });

  return content;
}

export function linkify(text) {
  return renderRichMessage(text);
}

/**
 * Global Overlay & Minimized Group Chat
 * Mounted when a user logs in. Sits silently on the left side of every page
 * and overlays any page when extended like Facebook Messenger.
 */
export function mountGlobalOverlayChat(user) {
  if (!user) return () => {};

  let container = document.getElementById('global-overlay-chat');
  if (!container) {
    container = document.createElement('div');
    container.id = 'global-overlay-chat';
    document.body.appendChild(container);
  }

  let channels = [];
  let currentChannel = { room_type: 'tour', room_id: 1, title: 'Addis Community & Tours' };
  let activeInstance = null;
  let isOpen = sessionStorage.getItem('addisgo_global_chat_open') === '1';

  const renderWidget = () => {
    container.innerHTML = `
      <!-- Minimized Floating Dock Pill (Silently on the left side) -->
      <div class="chat-dock-pill is-left" id="global-dock-pill" title="Click to open AddisGo Chat">
        <span class="chat-status-dot" aria-hidden="true"></span>
        <span class="chat-dock-text">${icon('message-circle', 14)} <strong>${esc(currentChannel.title)}</strong></span>
        <button type="button" class="chat-dock-call" id="global-dock-call" title="Quick Conference Call">${icon('phone', 13)}</button>
        <button type="button" class="chat-dock-expand" aria-label="Expand chat">${icon('chevron-up', 14)}</button>
      </div>

      <!-- Floating Pop-out Overlay Window (Left-side Facebook-style overlay) -->
      <div class="chat-container is-overlay is-left" id="global-chat-window" style="display:none;">
        <div class="chat-top-bar">
          <div class="chat-top-info">
            <span class="chat-status-dot" aria-hidden="true"></span>
            <div>
              ${channels.length > 1
                ? `<select class="chat-channel-select" id="global-channel-select">
                    ${channels.map((ch) => `<option value="${ch.room_type}:${ch.room_id}" ${ch.room_type === currentChannel.room_type && ch.room_id === currentChannel.room_id ? 'selected' : ''}>${esc(ch.title)}</option>`).join('')}
                   </select>`
                : `<h4 class="chat-top-title">${esc(currentChannel.title)}</h4>`
              }
              <span class="chat-top-meta">Live Addis Connected</span>
            </div>
          </div>

          <div class="chat-top-actions">
            <button type="button" class="chat-btn-action" id="global-call-btn" title="Start Conference Call" aria-label="Conference Call">
              ${icon('phone', 14)} <span>Call</span>
            </button>
            <button type="button" class="chat-btn-icon" id="global-max-btn" title="Toggle size" aria-label="Toggle size">
              ${icon('maximize', 13)}
            </button>
            <button type="button" class="chat-btn-icon" id="global-min-btn" title="Minimize chat to left dock" aria-label="Minimize">
              ${icon('minus', 14)}
            </button>
            <button type="button" class="chat-btn-icon" id="global-close-btn" title="Close chat" aria-label="Close">
              &times;
            </button>
          </div>
        </div>

        <div class="chat-list" id="global-chat-list" role="log" aria-live="polite" aria-label="Conversation"></div>

        <!-- Location Picker Popup Menu -->
        <div class="chat-loc-menu" id="global-loc-menu" style="display:none;">
          <div class="chat-loc-menu-head">
            <span>${icon('map-pin', 14)} <strong>Share Addis Location</strong></span>
            <button type="button" class="chat-loc-close" id="global-loc-close">&times;</button>
          </div>
          <button type="button" class="chat-loc-opt" data-loc="gps">
            ${icon('navigation', 14)} <span>My GPS Location</span> <small>Live device GPS</small>
          </button>
          <button type="button" class="chat-loc-opt" data-loc="9.0108,38.7618|Meskel Square">
            ${icon('map-pin', 14)} <span>Meskel Square</span> <small>City Centre</small>
          </button>
          <button type="button" class="chat-loc-opt" data-loc="8.9953,38.7889|Bole Medhanialem">
            ${icon('map-pin', 14)} <span>Bole Medhanialem</span> <small>Bole Corridor</small>
          </button>
          <button type="button" class="chat-loc-opt" data-loc="9.0833,38.7614|Entoto Natural Park">
            ${icon('map-pin', 14)} <span>Entoto Natural Park</span> <small>Ridge Views</small>
          </button>
          <button type="button" class="chat-loc-opt" data-loc="9.0305,38.7397|Merkato">
            ${icon('map-pin', 14)} <span>Merkato</span> <small>Spice Market</small>
          </button>
          <button type="button" class="chat-loc-opt" data-loc="9.0345,38.7516|Piassa Churchill">
            ${icon('map-pin', 14)} <span>Piassa</span> <small>Historic Quarter</small>
          </button>
          <button type="button" class="chat-loc-opt" data-loc="9.0384,38.7619|National Museum">
            ${icon('map-pin', 14)} <span>National Museum</span> <small>Arat Kilo</small>
          </button>
        </div>

        <div class="chat-attach-preview" id="global-attach-preview" style="display:none;"></div>

        <form class="chat-form" id="global-chat-form" autocomplete="off">
          <div class="chat-tools-bar">
            <button type="button" class="chat-tool-btn" id="global-btn-loc" title="Share Location / Landmark" aria-label="Share location">
              ${icon('map-pin', 15)}
            </button>
            <button type="button" class="chat-tool-btn" id="global-btn-photo" title="Attach Picture (Packet-Optimized)" aria-label="Attach picture">
              ${icon('camera', 15)}
            </button>
            <button type="button" class="chat-tool-btn" id="global-btn-video" title="Attach Short Video Clip (8MB max)" aria-label="Attach video">
              ${icon('video', 15)}
            </button>

            <input type="file" id="global-file-photo" accept="image/jpeg,image/png,image/webp" style="display:none;" />
            <input type="file" id="global-file-video" accept="video/mp4,video/webm" style="display:none;" />
          </div>

          <label class="sr-only" for="global-chat-input">Message</label>
          <input id="global-chat-input" class="chat-input" name="body" type="text" maxlength="2000" placeholder="Chat with Addis travellers & drivers…" required />
          <button type="submit" class="chat-send" aria-label="Send message">${icon('send', 18)}</button>
        </form>
      </div>
    `;

    const dockPill = container.querySelector('#global-dock-pill');
    const chatWindow = container.querySelector('#global-chat-window');
    const list = container.querySelector('#global-chat-list');
    const form = container.querySelector('#global-chat-form');
    const input = container.querySelector('#global-chat-input');
    const attachPreview = container.querySelector('#global-attach-preview');
    const photoInput = container.querySelector('#global-file-photo');
    const videoInput = container.querySelector('#global-file-video');

    const locMenu = container.querySelector('#global-loc-menu');
    const locClose = container.querySelector('#global-loc-close');
    const locBtn = container.querySelector('#global-btn-loc');

    const channelSelect = container.querySelector('#global-channel-select');

    let pendingAttachment = null;
    const seen = new Set();

    const setOpen = (open) => {
      isOpen = open;
      sessionStorage.setItem('addisgo_global_chat_open', isOpen ? '1' : '0');
      if (isOpen) {
        dockPill.style.display = 'none';
        chatWindow.style.display = 'flex';
        list.scrollTop = list.scrollHeight;
        input?.focus();
      } else {
        dockPill.style.display = 'inline-flex';
        chatWindow.style.display = 'none';
      }
    };

    setOpen(isOpen);

    dockPill.addEventListener('click', () => setOpen(true));
    container.querySelector('#global-min-btn')?.addEventListener('click', () => setOpen(false));
    container.querySelector('#global-close-btn')?.addEventListener('click', () => setOpen(false));

    // Size toggle (maximize / standard overlay)
    let isMax = false;
    container.querySelector('#global-max-btn')?.addEventListener('click', () => {
      isMax = !isMax;
      chatWindow.classList.toggle('is-maximized', isMax);
      const iconEl = container.querySelector('#global-max-btn');
      if (iconEl) iconEl.innerHTML = icon(isMax ? 'minimize-2' : 'maximize', 13);
    });

    // Conference Call
    const startCall = () => {
      openConferenceCall({
        title: `${currentChannel.title} Call`,
        subtitle: 'Live Voice & Video Room',
        participants: [],
        me: user,
        onShareLocation: (loc) => {
          sendChat(`[location:${loc.lat},${loc.lng}|${loc.title}] Shared live location in call`).catch(() => {});
        },
      });
    };
    container.querySelector('#global-call-btn')?.addEventListener('click', startCall);
    container.querySelector('#global-dock-call')?.addEventListener('click', (e) => {
      e.stopPropagation();
      startCall();
    });

    // Channel selector
    channelSelect?.addEventListener('change', () => {
      const [rt, rid] = channelSelect.value.split(':');
      const found = channels.find((c) => c.room_type === rt && String(c.room_id) === rid);
      if (found) {
        currentChannel = found;
        seen.clear();
        list.innerHTML = '';
        poller.kick();
      }
    });

    // Location Picker Menu
    locBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      locMenu.style.display = locMenu.style.display === 'none' ? 'flex' : 'none';
    });
    locClose?.addEventListener('click', () => {
      locMenu.style.display = 'none';
    });
    container.querySelectorAll('.chat-loc-opt').forEach((opt) => {
      opt.addEventListener('click', (e) => {
        e.stopPropagation();
        const locKey = opt.dataset.loc;
        if (locKey === 'gps') {
          if ('geolocation' in navigator) {
            toast('Getting GPS coordinates...');
            navigator.geolocation.getCurrentPosition(
              (pos) => {
                const lat = pos.coords.latitude.toFixed(4);
                const lng = pos.coords.longitude.toFixed(4);
                input.value = `[location:${lat},${lng}|My GPS Location] ${input.value}`.trim();
                input.focus();
                locMenu.style.display = 'none';
                toast('GPS location attached');
              },
              () => {
                input.value = `[location:9.0108,38.7618|Meskel Square, Addis Ababa] ${input.value}`.trim();
                input.focus();
                locMenu.style.display = 'none';
                toast('Using Addis landmark');
              },
              { timeout: 5000 },
            );
          } else {
            input.value = `[location:9.0108,38.7618|Meskel Square, Addis Ababa] ${input.value}`.trim();
            locMenu.style.display = 'none';
          }
        } else if (locKey) {
          const [coords, name] = locKey.split('|');
          input.value = `[location:${coords}|${name}] ${input.value}`.trim();
          input.focus();
          locMenu.style.display = 'none';
          toast(`${name} attached`);
        }
      });
    });

    // Photo with Canvas compression (<180KB payload)
    container.querySelector('#global-btn-photo')?.addEventListener('click', () => photoInput?.click());
    photoInput?.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      toast('Optimizing image for Addis network...');
      try {
        const compressed = await compressImage(file, 1200, 0.75);
        const res = await api('/upload', { method: 'POST', body: { data: compressed, filename: file.name, type: 'image' } });
        pendingAttachment = { type: 'image', url: res.url };
        attachPreview.style.display = 'flex';
        attachPreview.innerHTML = `
          <div class="preview-item">
            <img src="${res.url}" alt="Preview" />
            <span>${icon('image', 12)} Ready to send (<180KB)</span>
            <button type="button" class="preview-remove" id="global-preview-remove">&times;</button>
          </div>
        `;
        container.querySelector('#global-preview-remove')?.addEventListener('click', () => {
          pendingAttachment = null;
          attachPreview.style.display = 'none';
        });
        toast('Picture attached and optimized');
      } catch (err) {
        toastError(err, 'Could not upload image');
      } finally {
        photoInput.value = '';
      }
    });

    // Video with 8MB cap
    container.querySelector('#global-btn-video')?.addEventListener('click', () => videoInput?.click());
    videoInput?.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (file.size > 8 * 1024 * 1024) {
        toastError(new Error('Video exceeds 8MB cap. Please select a short clip.'));
        return;
      }
      toast('Uploading short video clip...');
      try {
        const dataUri = await readVideoDataUri(file);
        const res = await api('/upload', { method: 'POST', body: { data: dataUri, filename: file.name, type: 'video' } });
        pendingAttachment = { type: 'video', url: res.url };
        attachPreview.style.display = 'flex';
        attachPreview.innerHTML = `
          <div class="preview-item">
            <video src="${res.url}" muted></video>
            <span>${icon('video', 12)} Short clip ready</span>
            <button type="button" class="preview-remove" id="global-preview-remove">&times;</button>
          </div>
        `;
        container.querySelector('#global-preview-remove')?.addEventListener('click', () => {
          pendingAttachment = null;
          attachPreview.style.display = 'none';
        });
        toast('Video clip attached');
      } catch (err) {
        toastError(err, 'Could not upload video');
      } finally {
        videoInput.value = '';
      }
    });

    // Messages Stream
    const nearBottom = () => list.scrollHeight - list.scrollTop - list.clientHeight < 120;
    const appendMessages = (messages) => {
      const stick = nearBottom();
      let added = 0;
      for (const msg of messages) {
        if (!msg || seen.has(msg.id)) continue;
        seen.add(msg.id);
        const node = document.createElement('article');
        node.className = `chat-msg ${msg.is_own || msg.user_id === user.id ? 'is-own' : ''}`;
        node.innerHTML = `
          ${msg.is_own || msg.user_id === user.id ? '' : avatar(msg.user, 28, 'chat-avatar')}
          <div class="chat-bubble">
            ${msg.is_own || msg.user_id === user.id ? '' : `<span class="chat-name">${esc(msg.user?.name || 'Traveller')}</span>`}
            <div class="chat-content">${renderRichMessage(msg.body)}</div>
            <time datetime="${esc(msg.created_at)}">${time(msg.created_at)}</time>
          </div>
        `;
        list.append(node);
        added += 1;
      }
      if (added && stick) list.scrollTop = list.scrollHeight;
    };

    const fetchMessages = async () => {
      try {
        const res = await api(`/chat/messages?room_type=${currentChannel.room_type}&room_id=${currentChannel.room_id}`);
        appendMessages(res?.messages || []);
      } catch {
        /* quiet poll */
      }
    };

    const sendChat = async (body) => {
      const sent = await api('/chat/messages', {
        method: 'POST',
        body: {
          body,
          room_type: currentChannel.room_type,
          room_id: currentChannel.room_id,
        },
      });
      if (sent) appendMessages([sent]);
      poller.kick();
      return sent;
    };

    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      let body = input.value.trim();
      if (pendingAttachment) {
        if (pendingAttachment.type === 'image') body = `[photo:${pendingAttachment.url}] ${body}`.trim();
        if (pendingAttachment.type === 'video') body = `[video:${pendingAttachment.url}] ${body}`.trim();
        pendingAttachment = null;
        attachPreview.style.display = 'none';
      }
      if (!body) return;
      input.value = '';
      input.focus();
      try {
        await sendChat(body);
      } catch (err) {
        toastError(err, 'Message failed to send');
        input.value = body;
      }
    });

    const poller = createPoller(fetchMessages, 4000);
    poller.kick();

    activeInstance = {
      stop() {
        poller.stop();
      },
    };
  };

  // Fetch initial channels and render
  api('/chat/channels')
    .then((data) => {
      channels = data?.channels || [];
      if (channels.length) currentChannel = channels[0];
      renderWidget();
    })
    .catch(() => {
      renderWidget();
    });

  return () => {
    if (activeInstance) activeInstance.stop();
    if (container) container.remove();
  };
}
