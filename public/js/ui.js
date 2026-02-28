/**
 * ui.js – DOM manipulation helpers and UI state.
 */
const UI = (() => {
  // ─── element refs ──────────────────────────────────────────────────────
  const $ = (sel) => document.querySelector(sel);
  const startScreen     = $('#startScreen');
  const transferScreen  = $('#transferScreen');
  const peerGrid        = $('#peerGrid');
  const addPeerTile     = $('#addPeerTile');
  const connectionBadge = $('#connectionBadge');
  const myNameInput     = $('#myName');

  // Transfer screen
  const btnBack         = $('#btnBack');
  const peerAvatarLg    = $('#peerAvatarLg');
  const peerNameLg      = $('#peerNameLg');
  const peerStatusLg    = $('#peerStatusLg');
  const dropZone        = $('#dropZone');
  const fileInput       = $('#fileInput');
  const btnBrowse       = $('#btnBrowse');
  const selectedFilesCt = $('#selectedFiles');
  const btnSend         = $('#btnSend');
  const progressSection = $('#progressSection');
  const progressBar     = $('#progressBar');
  const progressText    = $('#progressText');
  const speedText       = $('#speedText');
  const transferTitle   = $('#transferTitle');

  // Incoming
  const incomingSection = $('#incomingSection');
  const incomingFiles   = $('#incomingFiles');
  const btnAccept       = $('#btnAccept');
  const btnReject       = $('#btnReject');

  // Modal
  const modalOverlay    = $('#modalOverlay');
  const modalClose      = $('#modalClose');
  const connectLink     = $('#connectLink');
  const btnCopyLink     = $('#btnCopyLink');

  const toasts          = $('#toasts');

  // ─── helpers ───────────────────────────────────────────────────────────
  function initials(name) {
    return (name || '??').split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
  }

  function humanSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  function avatarColor(id) {
    const colors = ['#e94560','#0d7377','#14a76c','#ff6b6b','#6c5ce7','#e17055','#00b894','#fdcb6e','#636e72','#d63031'];
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) & 0xffffffff;
    return colors[Math.abs(h) % colors.length];
  }

  // ─── public API ────────────────────────────────────────────────────────

  function setConnectionStatus(online) {
    const dot = connectionBadge.querySelector('.dot');
    const txt = connectionBadge.querySelector('.badge-text');
    dot.className = 'dot ' + (online ? 'online' : 'offline');
    txt.textContent = online ? 'Online' : 'Offline';
    connectionBadge.title = online ? 'Connected to signaling server' : 'Disconnected';
  }

  /**
   * Render peer tiles.
   * @param {Array<{peerId, name, online}>} peers
   * @param {function} onSelect  – called with peerId when tile is clicked
   * @param {function} onRemove  – called with peerId when × is clicked
   */
  function renderPeerTiles(peers, onSelect, onRemove) {
    // Remove existing tiles (except add-tile)
    peerGrid.querySelectorAll('.peer-tile:not(.add-tile)').forEach(el => el.remove());

    peers.forEach(p => {
      const tile = document.createElement('div');
      tile.className = 'peer-tile';
      tile.dataset.peerId = p.peerId;

      tile.innerHTML = `
        <button class="tile-remove" title="Remove">&times;</button>
        <div class="tile-avatar" style="background:${avatarColor(p.peerId)}">
          ${initials(p.name)}
          <span class="tile-status ${p.online ? 'online' : 'offline'}"></span>
        </div>
        <span class="tile-label">${_esc(p.name)}</span>
        <span class="tile-sublabel">${p.online ? 'Online' : 'Last seen ' + _timeAgo(p.lastSeen)}</span>
      `;

      tile.addEventListener('click', (e) => {
        if (e.target.closest('.tile-remove')) return;
        onSelect(p.peerId);
      });
      tile.querySelector('.tile-remove').addEventListener('click', (e) => {
        e.stopPropagation();
        onRemove(p.peerId);
      });

      peerGrid.insertBefore(tile, addPeerTile);
    });
  }

  /** Update a single tile's online status without full re-render */
  function updateTileStatus(peerId, online, name) {
    const tile = peerGrid.querySelector(`.peer-tile[data-peer-id="${peerId}"]`);
    if (!tile) return;
    const dot = tile.querySelector('.tile-status');
    if (dot) dot.className = 'tile-status ' + (online ? 'online' : 'offline');
    const sub = tile.querySelector('.tile-sublabel');
    if (sub) sub.textContent = online ? 'Online' : 'Just now';
    if (name) {
      const lbl = tile.querySelector('.tile-label');
      if (lbl) lbl.textContent = name;
      const av = tile.querySelector('.tile-avatar');
      // Update initials (only text node)
      if (av) {
        const statusEl = av.querySelector('.tile-status');
        av.textContent = '';
        av.append(initials(name));
        av.appendChild(statusEl);
      }
    }
  }

  // ─── screens ───────────────────────────────────────────────────────────
  function showStartScreen() {
    startScreen.classList.add('active');
    transferScreen.classList.remove('active');
  }

  function showTransferScreen(peerInfo) {
    startScreen.classList.remove('active');
    transferScreen.classList.add('active');
    peerAvatarLg.textContent = initials(peerInfo.name);
    peerAvatarLg.style.background = avatarColor(peerInfo.peerId);
    peerNameLg.textContent = peerInfo.name;
    peerStatusLg.textContent = peerInfo.online ? 'online' : 'offline';
    peerStatusLg.className = 'peer-status ' + (peerInfo.online ? 'online' : 'offline');

    // Reset transfer UI
    selectedFilesCt.hidden = true;
    selectedFilesCt.innerHTML = '';
    btnSend.disabled = true;
    progressSection.hidden = true;
    incomingSection.hidden = true;
  }

  function updateTransferPeerStatus(online) {
    peerStatusLg.textContent = online ? 'online' : 'offline';
    peerStatusLg.className = 'peer-status ' + (online ? 'online' : 'offline');
  }

  // ─── selected files list ──────────────────────────────────────────────
  function showSelectedFiles(files) {
    selectedFilesCt.hidden = false;
    selectedFilesCt.innerHTML = '';
    files.forEach((f, i) => {
      const div = document.createElement('div');
      div.className = 'selected-file';
      div.innerHTML = `<span class="sf-name">${_esc(f.name)}</span><span class="sf-size">${humanSize(f.size)}</span><button class="sf-remove" data-idx="${i}">&times;</button>`;
      selectedFilesCt.appendChild(div);
    });
    btnSend.disabled = files.length === 0;
  }

  // ─── progress ──────────────────────────────────────────────────────────
  function showProgress(title) {
    progressSection.hidden = false;
    transferTitle.textContent = title || 'Transferring…';
    progressBar.style.width = '0%';
    progressText.textContent = '0%';
    speedText.textContent = '';
  }

  function updateProgress(pct, speed) {
    progressBar.style.width = pct + '%';
    progressText.textContent = Math.round(pct) + '%';
    if (speed !== undefined) speedText.textContent = humanSize(speed) + '/s';
  }

  function hideProgress() {
    progressSection.hidden = true;
  }

  // ─── incoming offer ───────────────────────────────────────────────────
  function showIncomingOffer(fromName, files, onAccept, onReject) {
    incomingSection.hidden = false;
    incomingFiles.innerHTML = '';
    files.forEach(f => {
      const div = document.createElement('div');
      div.className = 'incoming-file';
      div.innerHTML = `<span>${_esc(f.name)}</span><span>${humanSize(f.size)}</span>`;
      incomingFiles.appendChild(div);
    });
    // Bind once
    btnAccept.onclick = () => { incomingSection.hidden = true; onAccept(); };
    btnReject.onclick = () => { incomingSection.hidden = true; onReject(); };
  }

  function hideIncoming() { incomingSection.hidden = true; }

  // ─── modal ──────────────────────────────────────────────────────────
  function showModal(link) {
    connectLink.value = link;
    modalOverlay.hidden = false;
  }

  function hideModal() {
    modalOverlay.hidden = true;
  }

  // ─── toasts ────────────────────────────────────────────────────────────
  function toast(message, type = '') {
    const el = document.createElement('div');
    el.className = 'toast ' + type;
    el.textContent = message;
    toasts.appendChild(el);
    setTimeout(() => { el.remove(); }, 4000);
  }

  // ─── util ──────────────────────────────────────────────────────────────
  function _esc(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function _timeAgo(ts) {
    if (!ts) return 'never';
    const diff = Date.now() - ts;
    if (diff < 60000) return 'just now';
    if (diff < 3600000) return Math.round(diff/60000) + 'm ago';
    if (diff < 86400000) return Math.round(diff/3600000) + 'h ago';
    return Math.round(diff/86400000) + 'd ago';
  }

  return {
    setConnectionStatus, renderPeerTiles, updateTileStatus,
    showStartScreen, showTransferScreen, updateTransferPeerStatus,
    showSelectedFiles, showProgress, updateProgress, hideProgress,
    showIncomingOffer, hideIncoming,
    showModal, hideModal,
    toast, humanSize, initials,
    // Element access for event binding in app.js
    el: {
      myNameInput, addPeerTile, btnBack, dropZone, fileInput,
      btnBrowse, btnSend, modalOverlay, modalClose, connectLink,
      btnCopyLink, selectedFilesCt,
    },
  };
})();
