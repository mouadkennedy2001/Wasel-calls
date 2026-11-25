'use strict';
const dgram = require('node:dgram');
const C = require('../shared/constants');

function makePacket(self, type) {
  return JSON.stringify({
    a: C.APP_ID,
    v: C.PROTOCOL_VERSION,
    t: type,
    id: self.id,
    n: self.name,
    h: self.hostId,
    p: self.port,
    u: self.udpPort,
    net: self.network,
    ts: Date.now()
  });
}

class Discovery {
  constructor(self, onUpdate) {
    this.self = self;
    this.onUpdate = onUpdate || (() => {});
    this.peers = new Map();
    this.hosts = new Map();
    this.socket = null;
    this.timer = null;
    this.cleanTimer = null;
  }

  start() {
    if (this.socket) return;
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    this.socket = socket;
    socket.on('error', () => { /* LAN may block broadcast; manual host still works */ });
    socket.on('message', (buf, rinfo) => this._onMessage(buf, rinfo));
    socket.bind(C.DISCOVERY_PORT, '0.0.0.0', () => {
      try { socket.setBroadcast(true); } catch (_) { /* ignore */ }
      this._broadcast('ping');
      this.timer = setInterval(() => this._broadcast('ping'), 4000);
      this.cleanTimer = setInterval(() => this._clean(), 5000);
      this._emit();
    });
  }

  _broadcast(type) {
    if (!this.socket) return;
    const data = Buffer.from(makePacket(this.self, type));
    for (const target of ['255.255.255.255', '192.168.255.255']) {
      try { this.socket.send(data, C.DISCOVERY_PORT, target); } catch (_) { /* ignore */ }
    }
  }

  _onMessage(buf, rinfo) {
    if (!buf || buf.length > 4096) return;
    let msg;
    try { msg = JSON.parse(buf.toString('utf8')); } catch (_) { return; }
    if (!msg || msg.a !== C.APP_ID || msg.v !== C.PROTOCOL_VERSION) return;
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(String(msg.id || ''))) return;
    if (msg.id === this.self.id) return;
    if (!Number.isFinite(msg.ts) || Math.abs(Date.now() - msg.ts) > 60000) return;
    const port = Number.isInteger(msg.p) && msg.p > 0 && msg.p < 65536 ? msg.p : C.DEFAULT_HTTP_PORT;
    const peer = {
      id: String(msg.id).slice(0, 64),
      name: String(msg.n || 'مستخدم').slice(0, 48),
      hostId: String(msg.h || '').slice(0, 64),
      port,
      udpPort: Number.isInteger(msg.u) && msg.u > 0 && msg.u < 65536 ? msg.u : C.UDP_VOICE_PORT,
      network: typeof msg.net === 'string' ? msg.net.slice(0, 64) : '',
      address: rinfo && /^(\d{1,3}\.){3}\d{1,3}$/.test(rinfo.address) ? rinfo.address : '',
      seen: Date.now()
    };
    this.peers.set(peer.id, peer);
    if (peer.hostId) this.hosts.set(peer.hostId, { ...peer, hostId: peer.hostId });
    if (msg.t === 'ping' && this.self.isHost) this._answer(peer);
    if (this.peers.size > C.MAX_PEERS) {
      const oldest = [...this.peers.values()].sort((a, b) => a.seen - b.seen)[0];
      if (oldest) this.peers.delete(oldest.id);
    }
    this._emit();
  }

  _answer(peer) {
    try {
      this.socket.send(Buffer.from(makePacket(this.self, 'pong')), C.DISCOVERY_PORT, peer.address || '255.255.255.255');
    } catch (_) { /* ignore */ }
  }

  _clean() {
    const now = Date.now();
    for (const [id, peer] of this.peers) if (now - peer.seen > 15000) this.peers.delete(id);
    for (const [id, host] of this.hosts) if (now - host.seen > 15000) this.hosts.delete(id);
    this._emit();
  }

  _emit() {
    const peers = [...this.peers.values()].map(({ id, name, network, port, seen }) => ({ id, name, network, port, seen }));
    const hosts = [...this.hosts.values()].map(({ id, hostId, name, port, network, address, seen }) => ({ id, hostId, name, port, network, address, seen }));
    this.onUpdate({ peers, hosts });
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    if (this.cleanTimer) clearInterval(this.cleanTimer);
    this.timer = this.cleanTimer = null;
    if (this.socket) {
      try { this.socket.close(); } catch (_) { /* ignore */ }
      this.socket = null;
    }
    this.peers.clear();
    this.hosts.clear();
    this._emit();
  }
}

module.exports = { Discovery };
