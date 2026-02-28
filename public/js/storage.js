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
    try { return JSON.parse(localStorage.getItem(KEY_PEERS)) || []; }
    catch { return []; }
  }

  function _savePeers(peers) {
    localStorage.setItem(KEY_PEERS, JSON.stringify(peers));
  }

  /** Add or update a known peer */
  function upsertPeer(peerId, name) {
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

  return { getMyId, getMyName, setMyName, getKnownPeers, upsertPeer, removePeer };
})();
