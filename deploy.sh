#!/bin/bash
# P2P Share on tirion.dk – Deployment via pm2
# Cloudflare Tunnel (http service) → signal.tirion.dk:6942
# No nginx/caddy needed — Cloudflare handles HTTPS + WSS upgrade.

set -e

# 1. Install dependencies
cd /home/admin/p2p-share/server && npm install

# 2. Start/restart with pm2
pm2 delete p2p-share 2>/dev/null || true
pm2 start /home/admin/p2p-share/server/index.js --name p2p-share

# 3. Save pm2 process list so it survives reboots
pm2 save

echo "✓ p2p-share running on port 6942"
echo "✓ Cloudflare Tunnel: signal.tirion.dk → http://localhost:6942"
