/**
 * peer.js – WebRTC peer connection management.
 *
 * Creates and manages RTCPeerConnection + DataChannel per remote peer.
 * Uses the SignalingClient for offer/answer/ICE exchange.
 */
class PeerManager {
  /**
   * @param {SignalingClient} signaling
   * @param {string} myId
   */
  constructor(signaling, myId) {
    this._sig = signaling;
    this._myId = myId;
    /** @type {Map<string, {pc: RTCPeerConnection, dc: RTCDataChannel|null, makingOffer: boolean}>} */
    this._peers = new Map();
    this._handlers = {};

    // ICE servers – use public STUN + optional TURN
    this._iceServers = [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
    ];

    // Listen for incoming signaling
    this._sig.on('signal', (msg) => this._onSignal(msg));
  }

  on(event, fn) {
    if (!this._handlers[event]) this._handlers[event] = [];
    this._handlers[event].push(fn);
  }

  _emit(event, ...args) {
    (this._handlers[event] || []).forEach(fn => fn(...args));
  }

  /** Get or create a peer connection to `remotePeerId` */
  _getOrCreate(remotePeerId) {
    if (this._peers.has(remotePeerId)) return this._peers.get(remotePeerId);

    const pc = new RTCPeerConnection({ iceServers: this._iceServers });
    const entry = { pc, dc: null, makingOffer: false };
    this._peers.set(remotePeerId, entry);

    // ICE candidates → signaling
    pc.onicecandidate = (ev) => {
      if (ev.candidate) {
        this._sig.sendSignal(remotePeerId, { type: 'ice-candidate', candidate: ev.candidate });
      }
    };

    // Handle incoming data channels
    pc.ondatachannel = (ev) => {
      entry.dc = ev.channel;
      this._setupDataChannel(remotePeerId, ev.channel);
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      this._emit('connection-state', remotePeerId, state);
      if (state === 'failed' || state === 'closed') {
        this._cleanup(remotePeerId);
      }
    };

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === 'failed') {
        pc.restartIce();
      }
    };

    return entry;
  }

  _setupDataChannel(remotePeerId, dc) {
    dc.binaryType = 'arraybuffer';

    dc.onopen = () => {
      this._emit('datachannel-open', remotePeerId, dc);
    };

    dc.onclose = () => {
      this._emit('datachannel-close', remotePeerId);
    };

    dc.onmessage = (ev) => {
      this._emit('datachannel-message', remotePeerId, ev.data);
    };

    dc.onerror = (err) => {
      console.error('DataChannel error with', remotePeerId, err);
    };
  }

  /** Initiate a connection and create a data channel to a remote peer */
  async connect(remotePeerId) {
    const entry = this._getOrCreate(remotePeerId);
    if (entry.dc && entry.dc.readyState === 'open') return entry.dc;

    // Create data channel (initiator side)
    const dc = entry.pc.createDataChannel('file-transfer', {
      ordered: true,
    });
    entry.dc = dc;
    this._setupDataChannel(remotePeerId, dc);

    // Create offer
    entry.makingOffer = true;
    try {
      const offer = await entry.pc.createOffer();
      await entry.pc.setLocalDescription(offer);
      this._sig.sendSignal(remotePeerId, { type: 'offer', sdp: entry.pc.localDescription });
    } finally {
      entry.makingOffer = false;
    }

    return dc;
  }

  /** Handle incoming signaling message */
  async _onSignal(msg) {
    const { from, payload } = msg;
    const entry = this._getOrCreate(from);
    const pc = entry.pc;

    try {
      if (payload.type === 'offer') {
        // "Perfect negotiation" polite peer logic
        const polite = this._myId < from; // deterministic: lower ID is polite
        const offerCollision = entry.makingOffer || pc.signalingState !== 'stable';

        if (offerCollision && !polite) {
          // Impolite peer ignores the incoming offer
          return;
        }

        await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        this._sig.sendSignal(from, { type: 'answer', sdp: pc.localDescription });

      } else if (payload.type === 'answer') {
        await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));

      } else if (payload.type === 'ice-candidate') {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
        } catch (e) {
          // Ignore errors adding candidates from mismatched sessions
        }
      }
    } catch (err) {
      console.error('Signal handling error with', from, err);
    }
  }

  getDataChannel(remotePeerId) {
    const entry = this._peers.get(remotePeerId);
    return entry ? entry.dc : null;
  }

  isConnected(remotePeerId) {
    const entry = this._peers.get(remotePeerId);
    return entry && entry.dc && entry.dc.readyState === 'open';
  }

  _cleanup(remotePeerId) {
    const entry = this._peers.get(remotePeerId);
    if (!entry) return;
    try { entry.dc && entry.dc.close(); } catch {}
    try { entry.pc.close(); } catch {}
    this._peers.delete(remotePeerId);
  }

  disconnect(remotePeerId) {
    this._cleanup(remotePeerId);
  }

  disconnectAll() {
    for (const id of this._peers.keys()) this._cleanup(id);
  }
}
