'use strict';
const dgram = require('node:dgram');
const C = require('../shared/constants');

const TYPE_AUDIO = 1;
const TYPE_REG = 2;
const TYPE_ACK = 3;
const HEADER = 53;
const MAX_PACKET = 1400;

function ascii(value, length) {
  const buf = Buffer.alloc(length);
  buf.write(String(value || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, length), 0, 'ascii');
  return buf;
}

function packet(type, id, room, seq, payload) {
  const head = Buffer.alloc(HEADER);
  head[0] = type;
  ascii(id, 16).copy(head, 1);
  ascii(room, 32).copy(head, 17);
  head.writeUInt32BE(seq >>> 0, 49);
  const body = payload ? Buffer.from(payload) : Buffer.alloc(0);
  return Buffer.concat([head, body]);
}

function parse(buf) {
  if (!buf || buf.length < HEADER || buf.length > MAX_PACKET || ![TYPE_AUDIO, TYPE_REG, TYPE_ACK].includes(buf[0])) return null;
  return {
    type: buf[0],
    id: buf.toString('ascii', 1, 17).replace(/\0+$/, ''),
    room: buf.toString('ascii', 17, 49).replace(/\0+$/, ''),
    seq: buf.readUInt32BE(49),
    payload: buf.subarray(HEADER)
  };
}

class UdpVoiceRelay {
  constructor() {
    this.socket = null;
    this.clients = new Map();
    this.cleanTimer = null;
  }

  start(port) {
    if (this.socket) return this.port;
    this.port = port || C.UDP_VOICE_PORT;
    this.socket = dgram.createSocket('udp4');
    this.socket.on('error', () => { /* ignore transient socket errors */ });
    this.socket.on('message', (buf, rinfo) => this._onMessage(buf, rinfo));
    this.socket.bind(this.port, '0.0.0.0');
    this.cleanTimer = setInterval(() => this._clean(), 10000);
    return this.port;
  }

  _onMessage(buf, rinfo) {
    const msg = parse(buf);
    if (!msg || !msg.id || !msg.room) return;
    const key = `${rinfo.address}:${rinfo.port}`;
    let client = this.clients.get(key);
    if (!client) {
      if (this.clients.size > 64) return;
      client = { id: msg.id, room: msg.room, address: rinfo.address, port: rinfo.port, count: 0, window: Date.now(), seen: Date.now() };
      this.clients.set(key, client);
    }
    client.seen = Date.now();
    if (msg.type === TYPE_REG) {
      try { this.socket.send(packet(TYPE_ACK, 'server', msg.room, 0), rinfo.port, rinfo.address); } catch (_) { /* ignore */ }
      return;
    }
    if (msg.type !== TYPE_AUDIO || msg.payload.length === 0) return;
    const now = Date.now();
    if (now - client.window > 1000) { client.window = now; client.count = 0; }
    if (++client.count > 70) return;
    for (const [otherKey, other] of this.clients) {
      if (otherKey === key || other.room !== client.room) continue;
      try { this.socket.send(buf, other.port, other.address); } catch (_) { /* ignore */ }
    }
  }

  _clean() {
    const now = Date.now();
    for (const [key, client] of this.clients) {
      if (now - client.seen > 20000) this.clients.delete(key);
    }
  }

  stop() {
    if (this.cleanTimer) clearInterval(this.cleanTimer);
    this.cleanTimer = null;
    if (this.socket) {
      try { this.socket.close(); } catch (_) { /* ignore */ }
      this.socket = null;
    }
    this.clients.clear();
  }
}

class UdpVoiceClient {
  constructor(host, port, id, room, onFrame) {
    this.host = host;
    this.port = port || C.UDP_VOICE_PORT;
    this.id = id;
    this.room = room;
    this.onFrame = onFrame || (() => {});
    this.seq = 0;
    this.socket = null;
    this.timer = null;
  }

  start() {
    if (this.socket) return true;
    if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(this.host) || this.host === '0.0.0.0') return false;
    this.socket = dgram.createSocket('udp4');
    this.socket.on('error', () => { /* ignore */ });
    this.socket.on('message', (buf) => {
      const msg = parse(buf);
      if (msg && msg.type === TYPE_AUDIO && msg.room === this.room && msg.id !== this.id) {
        this.onFrame(Buffer.from(msg.payload));
      }
    });
    this.socket.bind(0, '0.0.0.0', () => this._register());
    this.timer = setInterval(() => this._register(), 2000);
    return true;
  }

  _register() {
    this._send(TYPE_REG, Buffer.alloc(0));
  }

  _send(type, payload) {
    if (!this.socket) return;
    try {
      this.socket.send(packet(type, this.id, this.room, this.seq++, payload), this.port, this.host);
    } catch (_) { /* ignore */ }
  }

  send(pcm) {
    if (!pcm || !pcm.length || pcm.length > 1400 - HEADER) return false;
    this._send(TYPE_AUDIO, pcm);
    return true;
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.socket) {
      try { this.socket.close(); } catch (_) { /* ignore */ }
      this.socket = null;
    }
  }
}

module.exports = { UdpVoiceRelay, UdpVoiceClient, packet, parse, HEADER };
