import { bridge, isDesktop } from './bridge.js';
import { toast } from './ui.js';
import { socketURL } from './url.js';

class Net {
  constructor() {
    this.ws = null;
    this.host = null;
    this.port = 7788;
    this.connected = false;
    this.connecting = false;
    this.token = '';
    this.me = null;
    this.serverId = '';
    this.network = null;
    this.limits = { maxFile: 200 * 1024 * 1024, maxText: 4000, maxVoice: 12 };
    this.peers = new Map();
    this.rooms = new Map();
    this.members = new Map();
    this.udp = { host: '', port: 7790 };
    this.discovery = { peers: [], hosts: [] };
    this.events = new Map();
    this.retry = 0;
    this.retryTimer = null;
    this.intentionalClose = false;
    this.connectionId = 0;
    this.profile = null;
  }

  on(type, callback) {
    if (!this.events.has(type)) this.events.set(type, new Set());
    this.events.get(type).add(callback);
    return () => this.events.get(type)?.delete(callback);
  }

  emit(type, payload) {
    const set = this.events.get(type);
    if (!set) return;
    for (const cb of set) { try { cb(payload); } catch (e) { console.warn('net listener', e); } }
  }

  setDiscovery(data) {
    // The Capacitor plugin may report either { hosts, peers } or a plain array.
    const payload = Array.isArray(data) ? { hosts: data, peers: [] } : (data || {});
    this.discovery = {
      hosts: Array.isArray(payload.hosts) ? payload.hosts : [],
      peers: Array.isArray(payload.peers) ? payload.peers : []
    };
    const all = [
      ...this.discovery.hosts.map((h) => ({ address: h.address || h.ip, port: h.port || 7788, id: h.hostId || h.id, name: h.name, network: h.network })),
      ...this.discovery.peers.map((p) => ({ address: p.address || p.ip, port: p.port || 7788, id: p.id, name: p.name, network: p.network }))
    ].filter((x) => x.address);
    const seen = new Set();
    this.hostCandidates = all.filter((x) => {
      const key = x.address + ':' + x.port;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).sort((a, b) => String(a.id).localeCompare(String(b.id)));
    this.emit('discovery', this.discovery);
  }

  bestHost() {
    const candidates = this.hostCandidates || [];
    if (this.host) {
      const current = candidates.find((c) => c.address === this.host && c.port === this.port);
      if (current) return current;
    }
    return candidates[0] || null;
  }

  async connect(host, port, profile) {
    if (this.connecting) return false;
    const connectionId = ++this.connectionId;
    // Switching hosts must not let the previous socket's close event start a
    // reconnect loop against the old address.
    if (this.ws) {
      const previous = this.ws;
      previous.onopen = previous.onmessage = previous.onerror = previous.onclose = null;
      try { previous.close(); } catch (_) { /* ignore */ }
      this.ws = null;
    }
    this.intentionalClose = false;
    this.host = String(host || '').trim().replace(/^\[|\]$/g, '');
    this.port = Number(port) || 7788;
    this.connected = false;
    this.token = '';
    this.profile = { ...(this.profile || {}), ...(profile || {}) };
    if (!this.profile.deviceId) {
      if (typeof crypto.randomUUID === 'function') {
        this.profile.deviceId = crypto.randomUUID().replace(/-/g, '').slice(0, 24);
      } else {
        const bytes = new Uint8Array(12);
        crypto.getRandomValues(bytes);
        this.profile.deviceId = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
      }
    }
    this.connecting = true;
    this.emit('status', 'connecting');
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }

    return new Promise((resolve) => {
      let settled = false;
      let ws;
      try {
        ws = new WebSocket(socketURL(this.host, this.port));
      } catch (_) {
        this.connecting = false;
        this.emit('status', 'disconnected');
        resolve(false);
        return;
      }
      this.ws = ws;
      const handshakeTimer = setTimeout(() => {
        if (!this.connected) { try { ws.close(); } catch (_) { /* ignore */ } }
      }, 12000);

      ws.onopen = () => {
        this.sendRaw({
          t: 'hello',
          id: this.profile?.deviceId,
          username: this.profile?.username,
          name: this.profile?.displayName,
          avatar: this.profile?.avatar,
          bio: this.profile?.bio,
          status: this.profile?.status,
          accent: this.profile?.accent,
          network: String(this.network?.name || '').slice(0, 48),
          device: isDesktop ? 'desktop' : 'mobile'
        });
      };

      ws.onmessage = (event) => {
        if (connectionId !== this.connectionId) return;
        let msg;
        try { msg = JSON.parse(event.data); } catch (_) { return; }
        if (msg.t === 'welcome') {
          this.connected = true;
          this.connecting = false;
          this.retry = 0;
          clearTimeout(handshakeTimer);
          this.token = msg.token;
          this.me = msg.you;
          this.serverId = msg.serverId;
          this.network = msg.network || this.network;
          this.limits = msg.limits || this.limits;
          this.udp = msg.udp || this.udp;
          this.peers = new Map((msg.peers || []).map((p) => [p.id, p]));
          this.rooms = new Map((msg.rooms || []).map((r) => [r.id, r]));
          settled = true;
          this.emit('status', 'connected');
          this.emit('welcome', msg);
          resolve(true);
          return;
        }
        this.dispatch(msg);
      };

      ws.onerror = () => { /* onclose handles retry */ };

      ws.onclose = () => {
        clearTimeout(handshakeTimer);
        if (connectionId !== this.connectionId) return;
        const wasConnected = this.connected;
        this.connected = false;
        this.connecting = false;
        this.token = '';
        if (!settled) resolve(false);
        this.emit('status', 'disconnected');
        this.emit('disconnected', { wasConnected });
        if (!this.intentionalClose) this.scheduleReconnect();
      };
    });
  }

  dispatch(msg) {
    switch (msg.t) {
      case 'pong': break;
      case 'error':
        this.emit('server-error', msg);
        toast(msg.message || 'error', 'error');
        break;
      case 'peer:join':
      case 'peer:profile':
        if (msg.peer) { this.peers.set(msg.peer.id, msg.peer); this.emit('peers', this.peers); }
        break;
      case 'peer:leave':
        if (msg.id) { this.peers.delete(msg.id); this.emit('peers', this.peers); }
        break;
      case 'room:list':
        this.rooms = new Map((msg.rooms || []).map((r) => [r.id, r]));
        this.emit('rooms', this.rooms);
        break;
      case 'room:joined':
        this.members.set(msg.room.id, msg.members || []);
        this.emit('room:joined', msg);
        break;
      case 'room:left':
        this.emit('room:left', msg);
        break;
      case 'peer:join-room':
        {
          const list = this.members.get(msg.roomId) || [];
          const index = list.findIndex((p) => p.id === msg.peer.id);
          if (index < 0) list.push(msg.peer);
          this.members.set(msg.roomId, list);
          this.emit('members', { roomId: msg.roomId, members: list });
        }
        break;
      case 'peer:left-room':
        {
          const list = (this.members.get(msg.roomId) || []).filter((p) => p.id !== msg.id);
          this.members.set(msg.roomId, list);
          this.emit('members', { roomId: msg.roomId, members: list });
          this.emit('peer:left-room', msg);
        }
        break;
      case 'chat':
        this.emit('chat', msg.message);
        break;
      case 'dm':
        this.emit('dm', msg.message);
        break;
      case 'dm:history':
        this.emit('dm:history', msg);
        break;
      case 'typing':
        this.emit('typing', msg);
        break;
      case 'signal':
        this.emit('signal', msg);
        break;
      case 'file:shared':
        this.emit('file', msg.file);
        break;
      case 'profile:saved':
        this.emit('profile:saved', msg.profile);
        break;
      default:
        this.emit(msg.t, msg);
    }
  }

  scheduleReconnect() {
    if (this.retryTimer || this.intentionalClose) return;
    this.retry += 1;
    const delay = Math.min(1000 * Math.pow(1.6, this.retry), 10000);
    this.emit('status', 'reconnecting');
    this.retryTimer = setTimeout(async () => {
      this.retryTimer = null;
      const candidate = this.bestHost();
      const host = candidate ? candidate.address : this.host;
      const port = candidate ? candidate.port : this.port;
      if (host) await this.connect(host, port, this.profile);
    }, delay);
  }

  disconnect() {
    this.connectionId += 1;
    this.intentionalClose = true;
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
    this.connected = false;
    this.token = '';
    if (this.ws) {
      const ws = this.ws;
      ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
      try { ws.close(); } catch (_) { /* ignore */ }
    }
    this.ws = null;
  }

  sendRaw(obj) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    try { this.ws.send(JSON.stringify(obj)); return true; }
    catch (_) { return false; }
  }

  send(type, payload) {
    return this.sendRaw({ t: type, ...(payload || {}) });
  }

  async reconnectToBest(profile) {
    const candidate = this.bestHost();
    if (!candidate) return false;
    this.disconnect();
    return this.connect(candidate.address, candidate.port, profile);
  }
}

export const net = new Net();

bridge.app.info().then((info) => {
  if (info.network) net.network = info.network;
}).catch(() => {});

if (bridge.net?.onDiscovery) {
  bridge.net.onDiscovery((data) => net.setDiscovery(data));
}
