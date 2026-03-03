/**
 * app.js – Main orchestrator (Chat edition).
 *
 * Ties together: PeerStorage, SignalingClient, PeerManager,
 * FileTransfer, and UI.
 */
(() => {
  'use strict';

  // ── Configuration ──────────────────────────────────────────────────────
  const WS_URL = (() => {
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

  function _uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  // ── Online tracking ────────────────────────────────────────────────────
  /** peerId → { name, online } */
  const onlinePeers = new Map();

  // ── Core objects ───────────────────────────────────────────────────────
  const signaling    = new SignalingClient(WS_URL);
  const peerManager  = new PeerManager(signaling, myId);
  const fileTransfer = new FileTransfer();

  // ── State ──────────────────────────────────────────────────────────────
  let currentPeerId  = null;      // The peer we're chatting with
  let selectedFiles   = [];        // File[] selected for sending
  let folderName      = null;      // Non-null if sending a folder
  let receiveSession  = null;      // Active ReceiveSession
  let sendStartTime   = 0;
  let pendingFileOffer = null;     // { from, files, folderName } for incoming

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
    if (connectTo && connectTo !== myId) {
      PeerStorage.upsertPeer(connectTo, 'New Device');
      signaling.sendPairRequest(connectTo);
      refreshTiles();
    }
  });

  signaling.on('peers-list', (msg) => {
    msg.peers.forEach(p => {
      onlinePeers.set(p.peerId, { name: p.name, online: true });
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

    const known = PeerStorage.getKnownPeers().find(p => p.peerId === msg.peerId);
    if (known) {
      PeerStorage.upsertPeer(msg.peerId, msg.name);
    }

    UI.updateTileStatus(msg.peerId, msg.online, msg.name);

    if (msg.peerId === currentPeerId) {
      UI.updateTransferPeerStatus(msg.online, msg.name);
    }
  });

  // ── Pair request ───────────────────────────────────────────────────────
  signaling.on('pair-request', (msg) => {
    const { from, fromName } = msg;
    PeerStorage.upsertPeer(from, fromName);
    refreshTiles();
    UI.toast(`${fromName} paired with you!`, 'success');
  });

  // ── Text messages ──────────────────────────────────────────────────────
  signaling.on('text-message', (msg) => {
    const { from, fromName, text, msgId } = msg;
    PeerStorage.upsertPeer(from, fromName);
    refreshTiles();

    const chatMsg = {
      id: msgId || _uid(),
      type: 'text',
      from: from,
      text: text,
      timestamp: Date.now(),
    };
    PeerStorage.addChatMessage(from, chatMsg);

    // If currently chatting with this peer, show it
    if (currentPeerId === from) {
      UI.appendChatMessage(chatMsg, false);
    } else {
      UI.toast(`${fromName}: ${text.length > 40 ? text.slice(0, 40) + '…' : text}`, 'success');
    }
  });

  // ── File offer / accept via signaling ──────────────────────────────────
  signaling.on('file-offer', (msg) => {
    const { from, fromName, files } = msg;
    PeerStorage.upsertPeer(from, fromName);
    refreshTiles();

    // If we're not viewing this peer, switch to them
    if (currentPeerId !== from) {
      openChatScreen(from);
    }

    pendingFileOffer = { from, files, folderName: msg.folderName || null };

    UI.showIncomingOffer(fromName, files,
      // accept
      () => {
        signaling.sendFileAccept(from, true);
        receiveSession = fileTransfer.createReceiver();
        UI.showProgress('Waiting for data…');
      },
      // reject
      () => {
        signaling.sendFileAccept(from, false);
        pendingFileOffer = null;
      }
    );
  });

  signaling.on('file-accept', (msg) => {
    if (!msg.accepted) {
      UI.toast('Transfer declined', 'error');
      UI.hideProgress();
      return;
    }
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

    // Record in chat history
    const chatMsg = {
      id: _uid(),
      type: 'files',
      from: myId,
      files: selectedFiles.map(f => ({
        name: f.name,
        size: f.size,
        relativePath: f.webkitRelativePath || '',
      })),
      folderName: folderName,
      timestamp: Date.now(),
    };
    if (currentPeerId) {
      PeerStorage.addChatMessage(currentPeerId, chatMsg);
      UI.appendChatMessage(chatMsg, true);
    }

    UI.toast('Files sent!', 'success');
    setTimeout(() => UI.hideProgress(), 1500);
    selectedFiles = [];
    folderName = null;
  });

  fileTransfer.on('receive-progress', ({ receivedBytes, totalBytes }) => {
    const pct = totalBytes ? (receivedBytes / totalBytes * 100) : 0;
    UI.updateProgress(pct);
  });

  fileTransfer.on('receive-complete', (files) => {
    UI.updateProgress(100);

    // Record in chat history
    const from = pendingFileOffer ? pendingFileOffer.from : currentPeerId;
    const chatMsg = {
      id: _uid(),
      type: 'files',
      from: from || 'unknown',
      files: files.map(f => ({
        name: f.name,
        size: f.size,
        relativePath: f.relativePath || '',
      })),
      folderName: pendingFileOffer ? pendingFileOffer.folderName : null,
      timestamp: Date.now(),
    };
    const chatPeerId = from || currentPeerId;
    if (chatPeerId) {
      PeerStorage.addChatMessage(chatPeerId, chatMsg);
      if (currentPeerId === chatPeerId) {
        UI.appendChatMessage(chatMsg, false);
      }
    }

    UI.toast(`Received ${files.length} file(s)!`, 'success');
    setTimeout(() => UI.hideProgress(), 1500);
    receiveSession = null;
    pendingFileOffer = null;
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
    known.sort((a, b) => (b.online - a.online) || a.name.localeCompare(b.name));
    UI.renderPeerTiles(known, onSelectPeer, onRemovePeer);
  }

  function onSelectPeer(peerId) {
    openChatScreen(peerId);
  }

  function onRemovePeer(peerId) {
    PeerStorage.removePeer(peerId);
    PeerStorage.clearChatHistory(peerId);
    peerManager.disconnect(peerId);
    refreshTiles();
  }

  function openChatScreen(peerId) {
    currentPeerId = peerId;
    const stored = PeerStorage.getKnownPeers().find(p => p.peerId === peerId);
    const live = onlinePeers.get(peerId);
    const info = {
      peerId,
      name: (live && live.name) || (stored && stored.name) || 'Unknown',
      online: !!live,
    };
    selectedFiles = [];
    folderName = null;
    receiveSession = null;
    pendingFileOffer = null;

    const history = PeerStorage.getChatHistory(peerId);
    UI.showChatScreen(info, history, myId);
  }

  // ── Send text message ──────────────────────────────────────────────────
  function sendTextMessage() {
    const text = UI.el.chatInput.value.trim();
    if (!text || !currentPeerId) return;

    const live = onlinePeers.get(currentPeerId);
    if (!live) {
      UI.toast('Peer is offline', 'error');
      return;
    }

    const msgId = _uid();
    signaling.sendTextMessage(currentPeerId, text, msgId);

    const chatMsg = {
      id: msgId,
      type: 'text',
      from: myId,
      text: text,
      timestamp: Date.now(),
    };
    PeerStorage.addChatMessage(currentPeerId, chatMsg);
    UI.appendChatMessage(chatMsg, true);

    UI.el.chatInput.value = '';
    UI.el.chatInput.focus();
  }

  // ── Send files ─────────────────────────────────────────────────────────
  function initiateFileSend(files, senderFolderName) {
    if (!files.length || !currentPeerId) return;
    const live = onlinePeers.get(currentPeerId);
    if (!live) {
      UI.toast('Peer is offline. Wait until they come online.', 'error');
      return;
    }

    selectedFiles = files;
    folderName = senderFolderName || null;

    // Send file offer via signaling
    const fileMeta = files.map(f => ({
      name: f.name,
      size: f.size,
      type: f.type,
      relativePath: f.webkitRelativePath || '',
    }));
    signaling.sendFileOffer(currentPeerId, fileMeta, folderName);
    UI.showProgress('Waiting for approval…');

    PeerStorage.upsertPeer(currentPeerId, live.name);
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
    folderName = null;
    UI.showStartScreen();
    refreshTiles();
  });

  // ─── Text message ─────────────────────────────────────────────────────
  UI.el.btnSendMsg.addEventListener('click', sendTextMessage);
  UI.el.chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendTextMessage();
    }
  });

  // ─── File attachment ───────────────────────────────────────────────────
  UI.el.btnAttach.addEventListener('click', () => UI.el.fileInput.click());
  UI.el.btnFolder.addEventListener('click', () => UI.el.folderInput.click());

  UI.el.fileInput.addEventListener('change', () => {
    const files = Array.from(UI.el.fileInput.files);
    if (files.length) initiateFileSend(files, null);
    UI.el.fileInput.value = '';
  });

  UI.el.folderInput.addEventListener('change', () => {
    const files = Array.from(UI.el.folderInput.files);
    if (!files.length) return;
    // Extract folder name from the first file's webkitRelativePath
    const firstPath = files[0].webkitRelativePath || '';
    const fName = firstPath.split('/')[0] || 'Folder';
    initiateFileSend(files, fName);
    UI.el.folderInput.value = '';
  });

  // ─── Drag & drop on chat ──────────────────────────────────────────────
  let dragCounter = 0;
  const chatArea = UI.el.chatInputArea;

  document.addEventListener('dragenter', (e) => {
    if (!currentPeerId) return;
    e.preventDefault();
    dragCounter++;
    if (dragCounter === 1) UI.el.chatDropOverlay.hidden = false;
  });

  document.addEventListener('dragleave', (e) => {
    if (!currentPeerId) return;
    dragCounter--;
    if (dragCounter <= 0) {
      dragCounter = 0;
      UI.el.chatDropOverlay.hidden = true;
    }
  });

  document.addEventListener('dragover', (e) => {
    if (!currentPeerId) return;
    e.preventDefault();
  });

  document.addEventListener('drop', (e) => {
    if (!currentPeerId) return;
    e.preventDefault();
    dragCounter = 0;
    UI.el.chatDropOverlay.hidden = true;

    const items = e.dataTransfer.items;
    if (items && items.length > 0) {
      // Check for folder via webkitGetAsEntry
      const entries = [];
      let hasFolder = false;
      for (let i = 0; i < items.length; i++) {
        const entry = items[i].webkitGetAsEntry && items[i].webkitGetAsEntry();
        if (entry) {
          entries.push(entry);
          if (entry.isDirectory) hasFolder = true;
        }
      }

      if (hasFolder) {
        // Read folder recursively
        _readEntriesRecursive(entries).then(files => {
          if (files.length) {
            const fName = entries[0].name || 'Folder';
            initiateFileSend(files, fName);
          }
        });
        return;
      }
    }

    // Regular file drop
    const files = Array.from(e.dataTransfer.files);
    if (files.length) initiateFileSend(files, null);
  });

  /**
   * Recursively read files from FileSystemEntry objects.
   * Returns a flat array of File objects with webkitRelativePath emulated.
   */
  async function _readEntriesRecursive(entries) {
    const files = [];

    async function processEntry(entry, path) {
      if (entry.isFile) {
        const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
        // Create a new File with the relative path set
        const newFile = new File([file], file.name, { type: file.type, lastModified: file.lastModified });
        // We can't set webkitRelativePath, so store it as a custom property
        Object.defineProperty(newFile, 'webkitRelativePath', {
          value: path + file.name,
          writable: false,
        });
        files.push(newFile);
      } else if (entry.isDirectory) {
        const dirReader = entry.createReader();
        const subEntries = await new Promise((resolve, reject) => {
          const allEntries = [];
          const readBatch = () => {
            dirReader.readEntries(batch => {
              if (batch.length === 0) {
                resolve(allEntries);
              } else {
                allEntries.push(...batch);
                readBatch();
              }
            }, reject);
          };
          readBatch();
        });
        for (const sub of subEntries) {
          await processEntry(sub, path + entry.name + '/');
        }
      }
    }

    for (const entry of entries) {
      await processEntry(entry, '');
    }
    return files;
  }

  // ─── Clear chat ────────────────────────────────────────────────────────
  UI.el.btnClearChat.addEventListener('click', () => {
    if (!currentPeerId) return;
    PeerStorage.clearChatHistory(currentPeerId);
    // Re-render empty chat
    const stored = PeerStorage.getKnownPeers().find(p => p.peerId === currentPeerId);
    const live = onlinePeers.get(currentPeerId);
    UI.showChatScreen({
      peerId: currentPeerId,
      name: (live && live.name) || (stored && stored.name) || 'Unknown',
      online: !!live,
    }, [], myId);
  });

  // ── Boot ───────────────────────────────────────────────────────────────
  signaling.connect(myId, myName);
  refreshTiles();

  if (connectTo) {
    const cleanUrl = location.pathname;
    history.replaceState(null, '', cleanUrl);
  }

  console.log('[P2P Share] My ID:', myId, '| Name:', myName);
  console.log('[P2P Share] Signaling:', WS_URL);
})();
