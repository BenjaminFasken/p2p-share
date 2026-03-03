/**
 * ui.js – DOM manipulation helpers and UI state (Chat edition).
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

  // Chat screen
  const btnBack         = $('#btnBack');
  const peerAvatarLg    = $('#peerAvatarLg');
  const peerNameLg      = $('#peerNameLg');
  const peerStatusLg    = $('#peerStatusLg');
  const btnClearChat    = $('#btnClearChat');
  const chatMessages    = $('#chatMessages');
  const chatEmpty       = $('#chatEmpty');
  const chatInput       = $('#chatInput');
  const btnSendMsg      = $('#btnSendMsg');
  const btnAttach       = $('#btnAttach');
  const btnFolder       = $('#btnFolder');
  const fileInput       = $('#fileInput');
  const folderInput     = $('#folderInput');
  const chatInputArea   = $('#chatInputArea');
  const chatDropOverlay = $('#chatDropOverlay');

  // Progress
  const progressSection = $('#progressSection');
  const progressBar     = $('#progressBar');
  const progressText    = $('#progressText');
  const speedText       = $('#speedText');
  const transferTitle   = $('#transferTitle');

  // Incoming
  const incomingSection = $('#incomingSection');
  const incomingText    = $('#incomingText');
  const incomingFileList = $('#incomingFileList');
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
    if (!name) return '??';
    return name.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
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
    if (!id) return colors[0];
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) & 0xffffffff;
    return colors[Math.abs(h) % colors.length];
  }

  function _formatTime(ts) {
    const d = new Date(ts);
    const h = d.getHours().toString().padStart(2, '0');
    const m = d.getMinutes().toString().padStart(2, '0');
    return `${h}:${m}`;
  }

  function _formatDate(ts) {
    const d = new Date(ts);
    const today = new Date();
    if (d.toDateString() === today.toDateString()) return 'Today';
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

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

  // ─── public API ────────────────────────────────────────────────────────

  function setConnectionStatus(online) {
    const dot = connectionBadge.querySelector('.dot');
    const txt = connectionBadge.querySelector('.badge-text');
    dot.className = 'dot ' + (online ? 'online' : 'offline');
    txt.textContent = online ? 'Online' : 'Offline';
    connectionBadge.title = online ? 'Connected to signaling server' : 'Disconnected';
  }

  /**
   * Render peer tiles (home screen).
   */
  function renderPeerTiles(peers, onSelect, onRemove) {
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

  /**
   * Show the chat screen for a peer with their history.
   * @param {Object} peerInfo  { peerId, name, online }
   * @param {Array}  history   Array of chat messages
   * @param {string} myId      Own peer ID
   */
  function showChatScreen(peerInfo, history, myId) {
    startScreen.classList.remove('active');
    transferScreen.classList.add('active');

    peerAvatarLg.textContent = initials(peerInfo.name);
    peerAvatarLg.style.background = avatarColor(peerInfo.peerId);
    peerNameLg.textContent = peerInfo.name;
    peerStatusLg.textContent = peerInfo.online ? 'online' : 'offline';
    peerStatusLg.className = 'peer-status ' + (peerInfo.online ? 'online' : 'offline');

    // Reset state
    progressSection.hidden = true;
    incomingSection.hidden = true;
    chatInput.value = '';

    // Render history
    _renderChatHistory(history, myId);

    // Focus input
    setTimeout(() => chatInput.focus(), 100);
  }

  function _renderChatHistory(history, myId) {
    // Clear all but keep chatEmpty
    chatMessages.querySelectorAll('.chat-msg, .chat-date-sep').forEach(el => el.remove());

    if (!history || history.length === 0) {
      chatEmpty.style.display = '';
      return;
    }
    chatEmpty.style.display = 'none';

    let lastDate = '';
    history.forEach(msg => {
      const dateStr = _formatDate(msg.timestamp);
      if (dateStr !== lastDate) {
        lastDate = dateStr;
        const sep = document.createElement('div');
        sep.className = 'chat-date-sep';
        sep.innerHTML = `<span>${dateStr}</span>`;
        chatMessages.appendChild(sep);
      }
      _appendMessageEl(msg, msg.from === myId);
    });

    _scrollChat();
  }

  function _appendMessageEl(msg, isMe) {
    const el = document.createElement('div');
    const side = isMe ? 'sent' : 'received';

    if (msg.type === 'text') {
      el.className = `chat-msg ${side}`;
      el.innerHTML = `
        <span class="msg-text">${_esc(msg.text)}</span>
        <span class="msg-time">${_formatTime(msg.timestamp)}</span>
      `;
    } else if (msg.type === 'files') {
      // Files/folder message
      const files = msg.files || [];
      const isFolder = msg.folderName;

      if (isFolder) {
        el.className = `chat-msg ${side} file-msg folder-bubble`;
        el.innerHTML = `
          <div class="folder-bubble-header">
            <svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>
            <span class="folder-bubble-name">${_esc(msg.folderName)}</span>
          </div>
          <span class="folder-bubble-count">${files.length} file${files.length !== 1 ? 's' : ''} · ${humanSize(files.reduce((s,f) => s + (f.size||0), 0))}</span>
          <span class="msg-time">${_formatTime(msg.timestamp)}</span>
        `;
      } else if (files.length === 1) {
        const f = files[0];
        el.className = `chat-msg ${side} file-msg`;
        el.innerHTML = `
          <div class="file-bubble">
            <div class="file-bubble-icon">
              <svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>
            </div>
            <div class="file-bubble-info">
              <span class="file-bubble-name">${_esc(f.name)}</span>
              <span class="file-bubble-meta">${humanSize(f.size)}</span>
              ${f.relativePath ? `<span class="file-bubble-path">${_esc(f.relativePath)}</span>` : ''}
            </div>
          </div>
          <span class="msg-time">${_formatTime(msg.timestamp)}</span>
        `;
      } else {
        el.className = `chat-msg ${side} file-msg`;
        let filesHtml = files.slice(0, 5).map(f =>
          `<span class="file-bubble-name" style="font-size:.78rem">${_esc(f.name)} (${humanSize(f.size)})</span>`
        ).join('');
        if (files.length > 5) filesHtml += `<span class="file-bubble-meta">+${files.length - 5} more</span>`;
        el.innerHTML = `
          <div class="file-bubble">
            <div class="file-bubble-icon">
              <svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>
            </div>
            <div class="file-bubble-info">
              ${filesHtml}
            </div>
          </div>
          <span class="msg-time">${_formatTime(msg.timestamp)}</span>
        `;
      }
    }

    chatMessages.appendChild(el);
    return el;
  }

  /**
   * Append a single new message to the chat and scroll.
   */
  function appendChatMessage(msg, isMe) {
    chatEmpty.style.display = 'none';
    _appendMessageEl(msg, isMe);
    _scrollChat();
  }

  function _scrollChat() {
    requestAnimationFrame(() => {
      chatMessages.scrollTop = chatMessages.scrollHeight;
    });
  }

  function updateTransferPeerStatus(online, name) {
    peerStatusLg.textContent = online ? 'online' : 'offline';
    peerStatusLg.className = 'peer-status ' + (online ? 'online' : 'offline');
    if (name) peerNameLg.textContent = name;
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
    const totalSize = files.reduce((s, f) => s + (f.size || 0), 0);
    incomingText.textContent = `${fromName} wants to send ${files.length} file${files.length !== 1 ? 's' : ''} (${humanSize(totalSize)})`;

    incomingFileList.innerHTML = '';
    files.slice(0, 10).forEach(f => {
      const div = document.createElement('div');
      div.innerHTML = `<span>${_esc(f.name)}</span><span>${humanSize(f.size)}</span>`;
      incomingFileList.appendChild(div);
    });
    if (files.length > 10) {
      const more = document.createElement('div');
      more.textContent = `+${files.length - 10} more files`;
      incomingFileList.appendChild(more);
    }

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

  return {
    setConnectionStatus, renderPeerTiles, updateTileStatus,
    showStartScreen, showChatScreen, updateTransferPeerStatus,
    appendChatMessage,
    showProgress, updateProgress, hideProgress,
    showIncomingOffer, hideIncoming,
    showModal, hideModal,
    toast, humanSize, initials,
    el: {
      myNameInput, addPeerTile, btnBack, chatInput, btnSendMsg,
      btnAttach, btnFolder, fileInput, folderInput,
      chatInputArea, chatDropOverlay, chatMessages,
      btnClearChat,
      modalOverlay, modalClose, connectLink, btnCopyLink,
    },
  };
})();
