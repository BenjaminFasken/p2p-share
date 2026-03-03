/**
 * storage.js – Persist peer info and own identity in localStorage.
 */
const PeerStorage = (() => {
  const KEY_ID   = 'p2p_my_id';
  const KEY_NAME = 'p2p_my_name';
  const KEY_PEERS = 'p2p_known_peers';

  function _uid() {
    // crypto.randomUUID where available, else fallback
    if (crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  /** Get or create our persistent peer ID */
  function getMyId() {
    let id = localStorage.getItem(KEY_ID);
    if (!id) { id = _uid(); localStorage.setItem(KEY_ID, id); }
    return id;
  }

  function getMyName() {
    return localStorage.getItem(KEY_NAME) || '';
  }

  function setMyName(name) {
    localStorage.setItem(KEY_NAME, name);
  }

  /** Return an array of { peerId, name, lastSeen } */
  function getKnownPeers() {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY_PEERS)) || [];
      // Filter out any corrupt entries missing peerId
      return raw.filter(p => p && p.peerId);
    } catch { return []; }
  }

  function _savePeers(peers) {
    localStorage.setItem(KEY_PEERS, JSON.stringify(peers));
  }

  /** Add or update a known peer */
  function upsertPeer(peerId, name) {
    if (!peerId) return;
    const peers = getKnownPeers();
    const idx = peers.findIndex(p => p.peerId === peerId);
    const entry = { peerId, name: name || 'Unknown', lastSeen: Date.now() };
    if (idx >= 0) {
      peers[idx] = { ...peers[idx], ...entry };
    } else {
      peers.push(entry);
    }
    _savePeers(peers);
  }

  function removePeer(peerId) {
    const peers = getKnownPeers().filter(p => p.peerId !== peerId);
    _savePeers(peers);
  }

  // ── Chat history ─────────────────────────────────────────────────────
  function getChatHistory(peerId) {
    try { return JSON.parse(localStorage.getItem('p2p_chat_' + peerId)) || []; }
    catch { return []; }
  }

  function addChatMessage(peerId, message) {
    const history = getChatHistory(peerId);
    history.push(message);
    // Keep last 1000 messages
    if (history.length > 1000) history.splice(0, history.length - 1000);
    localStorage.setItem('p2p_chat_' + peerId, JSON.stringify(history));
    return message;
  }

  function clearChatHistory(peerId) {
    localStorage.removeItem('p2p_chat_' + peerId);
  }

  return { getMyId, getMyName, setMyName, getKnownPeers, upsertPeer, removePeer,
           getChatHistory, addChatMessage, clearChatHistory };
})();
