/**
 * signaling.js – WebSocket client for the signaling server.
 *
 * Usage:
 *   const sig = new SignalingClient('wss://tirion.dk/ws');
 *   sig.on('open',       ()   => { … })
 *   sig.on('registered',  msg => { … })
 *   sig.on('presence',    msg => { … })
 *   sig.on('signal',      msg => { … })
 *   sig.on('file-offer',  msg => { … })
 *   sig.on('file-accept', msg => { … })
 *   sig.on('peers-list',  msg => { … })
 *   sig.on('close',       ()  => { … })
 *
 *   sig.connect(peerId, name);
 *   sig.sendSignal(to, payload);
 *   sig.sendFileOffer(to, files);
 *   sig.sendFileAccept(to, accepted);
 */
class SignalingClient {
  constructor(url) {
    this._url = url;
    this._ws = null;
    this._handlers = {};
    this._peerId = null;
    this._name = null;
    this._reconnectDelay = 1000;
    this._maxReconnect = 30000;
    this._shouldReconnect = true;
  }

  on(event, fn) {
    if (!this._handlers[event]) this._handlers[event] = [];
    this._handlers[event].push(fn);
  }

  _emit(event, data) {
    (this._handlers[event] || []).forEach(fn => fn(data));
  }

  connect(peerId, name) {
    this._peerId = peerId;
    this._name = name;
    this._shouldReconnect = true;
    this._doConnect();
  }

  _doConnect() {
    if (this._ws) { try { this._ws.close(); } catch {} }

    this._ws = new WebSocket(this._url);

    this._ws.onopen = () => {
      this._reconnectDelay = 1000;
      this._ws.send(JSON.stringify({
        type: 'register',
        peerId: this._peerId,
        name: this._name,
      }));
      this._emit('open');
    };

    this._ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      this._emit(msg.type, msg);
    };

    this._ws.onclose = () => {
      this._emit('close');
      if (this._shouldReconnect) {
        setTimeout(() => this._doConnect(), this._reconnectDelay);
        this._reconnectDelay = Math.min(this._reconnectDelay * 1.5, this._maxReconnect);
      }
    };

    this._ws.onerror = () => {
      // onclose will fire after this
    };
  }

  disconnect() {
    this._shouldReconnect = false;
    if (this._ws) this._ws.close();
  }

  _send(obj) {
    if (this._ws && this._ws.readyState === WebSocket.OPEN) {
      this._ws.send(JSON.stringify(obj));
    }
  }

  sendSignal(to, payload) {
    this._send({ type: 'signal', to, payload });
  }

  sendFileOffer(to, files) {
    this._send({ type: 'file-offer', to, files });
  }

  sendFileAccept(to, accepted) {
    this._send({ type: 'file-accept', to, accepted });
  }

  updateName(name) {
    this._name = name;
    this._send({ type: 'update-name', name });
  }

  sendPairRequest(to) {
    this._send({ type: 'pair-request', to });
  }

  get connected() {
    return this._ws && this._ws.readyState === WebSocket.OPEN;
  }
}
