/**
 * app.js – Main orchestrator.
 *
 * Ties together: PeerStorage, SignalingClient, PeerManager,
 * FileTransfer, and UI.
 */
(() => {
  'use strict';

  // ── Configuration ──────────────────────────────────────────────────────
  // If the page is loaded over HTTPS the WS must be wss.
  const WS_URL = (() => {
    // When served from the same host as the signaling server:
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    return `${proto}://${location.host}/ws`;
  })();

  // ── Identity ───────────────────────────────────────────────────────────
  const myId   = PeerStorage.getMyId();
  let   myName = PeerStorage.getMyName() || _defaultName();
  PeerStorage.setMyName(myName);
  UI.el.myNameInput.value = myName;

  function _defaultName() {
    const adj  = ['Swift','Brave','Calm','Deft','Keen','Bold','Fair','Wise'];
    const noun = ['Fox','Bear','Wolf','Hawk','Lynx','Deer','Owl','Hare'];
    return adj[Math.random()*adj.length|0] + ' ' + noun[Math.random()*noun.length|0];
  }

  // ── Online tracking ────────────────────────────────────────────────────
  /** peerId → { name, online } */
  const onlinePeers = new Map();

  // ── Core objects ───────────────────────────────────────────────────────
  const signaling    = new SignalingClient(WS_URL);
  const peerManager  = new PeerManager(signaling, myId);
  const fileTransfer = new FileTransfer();

  // ── State ──────────────────────────────────────────────────────────────
  let currentPeerId = null;     // The peer we're viewing in transfer screen
  let selectedFiles  = [];       // File[] selected for sending
  let receiveSession = null;     // Active ReceiveSession
  let sendStartTime  = 0;

  // ── Check for ?connect=<peerId> in URL ─────────────────────────────────
  const urlParams = new URLSearchParams(location.search);
  const connectTo = urlParams.get('connect');

  // ── Signaling events ──────────────────────────────────────────────────
  signaling.on('open', () => {
    UI.setConnectionStatus(true);
  });

  signaling.on('close', () => {
    UI.setConnectionStatus(false);
  });

  signaling.on('registered', () => {
    UI.setConnectionStatus(true);
    // If we arrived here via a connect link, add that peer and request mutual pairing
    if (connectTo && connectTo !== myId) {
      PeerStorage.upsertPeer(connectTo, 'New Device');
      signaling.sendPairRequest(connectTo);
      refreshTiles();
    }
  });

  signaling.on('peers-list', (msg) => {
    msg.peers.forEach(p => {
      onlinePeers.set(p.peerId, { name: p.name, online: true });
      // Auto-save any peer we see that we're supposed to connect to
      if (p.peerId === connectTo) {
        PeerStorage.upsertPeer(p.peerId, p.name);
      }
    });
    refreshTiles();
  });

  signaling.on('presence', (msg) => {
    onlinePeers.set(msg.peerId, { name: msg.name, online: msg.online });
    if (!msg.online) {
      onlinePeers.delete(msg.peerId);
    }

    // If this peer is known, update their name
    const known = PeerStorage.getKnownPeers().find(p => p.peerId === msg.peerId);
    if (known) {
      PeerStorage.upsertPeer(msg.peerId, msg.name);
    }

    // Update tile
    UI.updateTileStatus(msg.peerId, msg.online, msg.name);

    // Update transfer screen if we're viewing this peer
    if (msg.peerId === currentPeerId) {
      UI.updateTransferPeerStatus(msg.online);
    }
  });

  // ── Pair request (mutual discovery) ────────────────────────────────────
  signaling.on('pair-request', (msg) => {
    const { from, fromName } = msg;
    PeerStorage.upsertPeer(from, fromName);
    refreshTiles();
    UI.toast(`${fromName} paired with you!`, 'success');
  });

  // ── File offer / accept via signaling ──────────────────────────────────
  signaling.on('file-offer', (msg) => {
    const { from, fromName, files } = msg;
    // Save peer
    PeerStorage.upsertPeer(from, fromName);
    refreshTiles();

    // If we're not viewing this peer, switch to them
    if (currentPeerId !== from) {
      openTransferScreen(from);
    }

    UI.showIncomingOffer(fromName, files,
      // accept
      () => {
        signaling.sendFileAccept(from, true);
        receiveSession = fileTransfer.createReceiver();
        UI.showProgress('Waiting for sender…');
      },
      // reject
      () => {
        signaling.sendFileAccept(from, false);
      }
    );
  });

  signaling.on('file-accept', (msg) => {
    if (!msg.accepted) {
      UI.toast('Transfer declined', 'error');
      UI.hideProgress();
      return;
    }
    // Accepted! Establish WebRTC and send the files
    _startSending(msg.from);
  });

  // ── WebRTC data channel messages → file receiver ──────────────────────
  peerManager.on('datachannel-message', (remotePeerId, data) => {
    if (receiveSession) {
      receiveSession.onMessage(data);
    }
  });

  peerManager.on('datachannel-open', (remotePeerId, dc) => {
    console.log('[WebRTC] DataChannel open with', remotePeerId);
  });

  // ── File transfer progress ─────────────────────────────────────────────
  fileTransfer.on('send-progress', ({ sentBytes, totalBytes }) => {
    const pct = totalBytes ? (sentBytes / totalBytes * 100) : 0;
    const elapsed = (Date.now() - sendStartTime) / 1000;
    const speed = elapsed > 0 ? sentBytes / elapsed : 0;
    UI.updateProgress(pct, speed);
  });

  fileTransfer.on('send-complete', () => {
    UI.updateProgress(100);
    UI.toast('Files sent successfully!', 'success');
    setTimeout(() => UI.hideProgress(), 2000);
  });

  fileTransfer.on('receive-progress', ({ receivedBytes, totalBytes }) => {
    const pct = totalBytes ? (receivedBytes / totalBytes * 100) : 0;
    UI.updateProgress(pct);
  });

  fileTransfer.on('receive-complete', (files) => {
    UI.updateProgress(100);
    UI.toast(`Received ${files.length} file(s)!`, 'success');
    setTimeout(() => UI.hideProgress(), 2000);
    receiveSession = null;
  });

  // ── Send logic ─────────────────────────────────────────────────────────
  async function _startSending(remotePeerId) {
    if (!selectedFiles.length) return;
    UI.showProgress('Connecting…');
    try {
      const dc = await peerManager.connect(remotePeerId);
      // Wait for channel to be open
      if (dc.readyState !== 'open') {
        await new Promise((res, rej) => {
          dc.addEventListener('open', res, { once: true });
          dc.addEventListener('error', rej, { once: true });
          setTimeout(() => rej(new Error('DataChannel open timeout')), 15000);
        });
      }
      UI.showProgress('Sending…');
      sendStartTime = Date.now();
      await fileTransfer.sendFiles(dc, selectedFiles);
    } catch (err) {
      console.error('Send error', err);
      UI.toast('Transfer failed: ' + err.message, 'error');
      UI.hideProgress();
    }
  }

  // ── Tile rendering ─────────────────────────────────────────────────────
  function refreshTiles() {
    const known = PeerStorage.getKnownPeers().map(p => {
      const live = onlinePeers.get(p.peerId);
      return {
        ...p,
        name: (live && live.name) || p.name,
        online: !!live,
      };
    });
    // Sort: online first, then by name
    known.sort((a, b) => (b.online - a.online) || a.name.localeCompare(b.name));
    UI.renderPeerTiles(known, onSelectPeer, onRemovePeer);
  }

  function onSelectPeer(peerId) {
    openTransferScreen(peerId);
  }

  function onRemovePeer(peerId) {
    PeerStorage.removePeer(peerId);
    peerManager.disconnect(peerId);
    refreshTiles();
  }

  function openTransferScreen(peerId) {
    currentPeerId = peerId;
    const stored = PeerStorage.getKnownPeers().find(p => p.peerId === peerId);
    const live = onlinePeers.get(peerId);
    const info = {
      peerId,
      name: (live && live.name) || (stored && stored.name) || 'Unknown',
      online: !!live,
    };
    selectedFiles = [];
    receiveSession = null;
    UI.showTransferScreen(info);
  }

  // ── UI event binding ──────────────────────────────────────────────────
  UI.el.myNameInput.addEventListener('change', () => {
    myName = UI.el.myNameInput.value.trim() || _defaultName();
    PeerStorage.setMyName(myName);
    UI.el.myNameInput.value = myName;
    signaling.updateName(myName);
  });

  UI.el.addPeerTile.addEventListener('click', () => {
    const link = `${location.origin}${location.pathname}?connect=${myId}`;
    UI.showModal(link);
  });

  UI.el.modalClose.addEventListener('click', () => UI.hideModal());
  UI.el.modalOverlay.addEventListener('click', (e) => {
    if (e.target === UI.el.modalOverlay) UI.hideModal();
  });

  UI.el.btnCopyLink.addEventListener('click', () => {
    navigator.clipboard.writeText(UI.el.connectLink.value).then(() => {
      UI.toast('Link copied!', 'success');
    });
  });

  UI.el.btnBack.addEventListener('click', () => {
    currentPeerId = null;
    selectedFiles = [];
    UI.showStartScreen();
    refreshTiles();
  });

  // ─── File selection ────────────────────────────────────────────────────
  UI.el.btnBrowse.addEventListener('click', (e) => { e.stopPropagation(); UI.el.fileInput.click(); });
  UI.el.dropZone.addEventListener('click', () => UI.el.fileInput.click());

  UI.el.fileInput.addEventListener('change', () => {
    selectedFiles = Array.from(UI.el.fileInput.files);
    UI.showSelectedFiles(selectedFiles);
    UI.el.fileInput.value = ''; // allow re-select
  });

  // Drag & drop
  UI.el.dropZone.addEventListener('dragover', (e) => { e.preventDefault(); UI.el.dropZone.classList.add('drag-over'); });
  UI.el.dropZone.addEventListener('dragleave', () => { UI.el.dropZone.classList.remove('drag-over'); });
  UI.el.dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    UI.el.dropZone.classList.remove('drag-over');
    selectedFiles = Array.from(e.dataTransfer.files);
    UI.showSelectedFiles(selectedFiles);
  });

  // Remove individual file
  UI.el.selectedFilesCt.addEventListener('click', (e) => {
    const btn = e.target.closest('.sf-remove');
    if (!btn) return;
    const idx = parseInt(btn.dataset.idx, 10);
    selectedFiles.splice(idx, 1);
    UI.showSelectedFiles(selectedFiles);
  });

  // Send button
  UI.el.btnSend.addEventListener('click', () => {
    if (!currentPeerId || !selectedFiles.length) return;
    const live = onlinePeers.get(currentPeerId);
    if (!live) {
      UI.toast('Peer is offline. Wait until they come online.', 'error');
      return;
    }
    // Send file offer via signaling for permission
    const fileMeta = selectedFiles.map(f => ({ name: f.name, size: f.size, type: f.type }));
    signaling.sendFileOffer(currentPeerId, fileMeta);
    UI.showProgress('Waiting for approval…');

    // Persist the peer
    PeerStorage.upsertPeer(currentPeerId, live.name);
  });

  // ── Boot ───────────────────────────────────────────────────────────────
  signaling.connect(myId, myName);
  refreshTiles();

  // Clean up URL params after processing ?connect=
  if (connectTo) {
    const cleanUrl = location.pathname;
    history.replaceState(null, '', cleanUrl);
  }

  console.log('[P2P Share] My ID:', myId, '| Name:', myName);
  console.log('[P2P Share] Signaling:', WS_URL);
})();
