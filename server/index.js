/**
 * P2P Share – WebSocket Signaling Server
 *
 * Deploy to tirion.dk.  Handles:
 *  - Peer registration (each browser gets a persistent UUID)
 *  - Presence tracking  (online / offline broadcasts)
 *  - WebRTC signaling relay  (offer / answer / ice-candidate)
 *  - File-transfer permission requests / responses
 *
 * Protocol (all messages are JSON):
 *
 *  → register    { type:"register", peerId, name }
 *  ← registered  { type:"registered", peerId }
 *
 *  ← presence    { type:"presence", peerId, name, online }
 *
 *  → signal      { type:"signal", to, payload }
 *  ← signal      { type:"signal", from, fromName, payload }
 *
 *  → file-offer  { type:"file-offer", to, files:[{name,size,type}] }
 *  ← file-offer  { type:"file-offer", from, fromName, files }
 *
 *  → file-accept { type:"file-accept", to, accepted:bool }
 *  ← file-accept { type:"file-accept", from, accepted }
 *
 *  → get-peers   { type:"get-peers" }
 *  ← peers-list  { type:"peers-list", peers:[{peerId,name,online}] }
 */

const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');
const fs = require('fs');

const PORT = parseInt(process.env.PORT, 10) || 6942;
const SERVE_STATIC = process.env.SERVE_STATIC !== '0'; // also serve the frontend

// ── state ───────────────────────────────────────────────────────────────────
/** @type {Map<string, {ws, peerId:string, name:string}>} */
const clients = new Map(); // peerId → client

// ── HTTP server (also serves the frontend) ──────────────────────────────────
const MIME = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const PUBLIC = path.resolve(__dirname, '..', 'public');

const httpServer = http.createServer((req, res) => {
  if (!SERVE_STATIC) { res.writeHead(404); res.end(); return; }

  let filePath = path.join(PUBLIC, req.url === '/' ? 'index.html' : req.url);
  const ext = path.extname(filePath);
  const mime = MIME[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      // SPA fallback
      fs.readFile(path.join(PUBLIC, 'index.html'), (e2, d2) => {
        if (e2) { res.writeHead(404); res.end('Not found'); return; }
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(d2);
      });
      return;
    }
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
  });
});

// ── WebSocket ───────────────────────────────────────────────────────────────
const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

function broadcast(msg, exclude) {
  const raw = JSON.stringify(msg);
  for (const [id, c] of clients) {
    if (id !== exclude && c.ws.readyState === 1) {
      c.ws.send(raw);
    }
  }
}

function sendTo(peerId, msg) {
  const c = clients.get(peerId);
  if (c && c.ws.readyState === 1) {
    c.ws.send(JSON.stringify(msg));
  }
}

function peersListFor(requesterId) {
  const list = [];
  for (const [id, c] of clients) {
    if (id !== requesterId) {
      list.push({ peerId: c.peerId, name: c.name, online: true });
    }
  }
  return list;
}

wss.on('connection', (ws) => {
  let peerId = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {
      // ── registration ────────────────────────────────────────────────────
      case 'register': {
        peerId = msg.peerId;
        const name = msg.name || 'Unknown Device';
        clients.set(peerId, { ws, peerId, name });

        // Confirm
        ws.send(JSON.stringify({ type: 'registered', peerId }));

        // Tell everyone this peer is online
        broadcast({ type: 'presence', peerId, name, online: true }, peerId);

        // Send the registering peer a list of who is already online
        const onlinePeers = [];
        for (const [id, c] of clients) {
          if (id !== peerId) {
            onlinePeers.push({ peerId: id, name: c.name, online: true });
          }
        }
        ws.send(JSON.stringify({ type: 'peers-list', peers: onlinePeers }));
        break;
      }

      // ── WebRTC signaling relay ──────────────────────────────────────────
      case 'signal': {
        if (!peerId || !msg.to) return;
        const sender = clients.get(peerId);
        sendTo(msg.to, {
          type: 'signal',
          from: peerId,
          fromName: sender ? sender.name : 'Unknown',
          payload: msg.payload,
        });
        break;
      }

      // ── File offer (forwarded to the target for permission) ─────────────
      case 'file-offer': {
        if (!peerId || !msg.to) return;
        const sender = clients.get(peerId);
        sendTo(msg.to, {
          type: 'file-offer',
          from: peerId,
          fromName: sender ? sender.name : 'Unknown',
          files: msg.files,
          folderName: msg.folderName || null,
        });
        break;
      }

      // ── File accept / reject ────────────────────────────────────────────
      case 'file-accept': {
        if (!peerId || !msg.to) return;
        sendTo(msg.to, {
          type: 'file-accept',
          from: peerId,
          accepted: msg.accepted,
        });
        break;
      }

      // ── Text message relay ──────────────────────────────────────────────
      case 'text-message': {
        if (!peerId || !msg.to) return;
        const tmSender = clients.get(peerId);
        sendTo(msg.to, {
          type: 'text-message',
          from: peerId,
          fromName: tmSender ? tmSender.name : 'Unknown',
          text: msg.text,
          msgId: msg.msgId,
        });
        break;
      }

      // ── Get full peer list ──────────────────────────────────────────────
      case 'get-peers': {
        ws.send(JSON.stringify({ type: 'peers-list', peers: peersListFor(peerId) }));
        break;
      }

      // ── Name update ─────────────────────────────────────────────────────
      case 'update-name': {
        if (!peerId) return;
        const c = clients.get(peerId);
        if (c) {
          c.name = msg.name;
          broadcast({ type: 'presence', peerId, name: msg.name, online: true }, peerId);
        }
        break;
      }

      // ── Pair request (mutual discovery) ─────────────────────────────────
      case 'pair-request': {
        if (!peerId || !msg.to) return;
        const s = clients.get(peerId);
        sendTo(msg.to, {
          type: 'pair-request',
          from: peerId,
          fromName: s ? s.name : 'Unknown',
        });
        break;
      }

      default:
        break;
    }
  });

  ws.on('close', () => {
    if (peerId && clients.has(peerId)) {
      const c = clients.get(peerId);
      clients.delete(peerId);
      broadcast({ type: 'presence', peerId, name: c.name, online: false });
    }
  });

  ws.on('error', () => {
    if (peerId) clients.delete(peerId);
  });
});

// ── start ───────────────────────────────────────────────────────────────────
httpServer.listen(PORT, () => {
  console.log(`Signaling server running on http://0.0.0.0:${PORT}`);
  console.log(`WebSocket endpoint: ws://0.0.0.0:${PORT}/ws`);
  if (SERVE_STATIC) console.log(`Serving frontend from ${PUBLIC}`);
});
