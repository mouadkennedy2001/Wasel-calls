'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { WebSocketServer, WebSocket } = require('ws');
const C = require('../shared/constants');
const V = require('../shared/validate');
const { getNetworkInfo } = require('./networkName');
const { UdpVoiceRelay } = require('./udpVoice');

const RENDERER_DIR = path.resolve(__dirname, '..', 'renderer');
const UPLOAD_DIR = path.join(process.env.WASEL_DATA_DIR || path.join(os.tmpdir(), 'wasel-call'), 'uploads');
const HISTORY_FILE = path.join(path.dirname(UPLOAD_DIR), 'chat-history.json');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff': 'font/woff',
  '.woff2': 'font/woff2', '.map': 'application/json'
};

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "connect-src 'self' http: ws: wss:",
  "worker-src 'self' blob:",
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'"
].join('; ');

function randomId(bytes) { return crypto.randomBytes(bytes).toString('hex'); }

function loadHistory() {
  try {
    const parsed = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
    return V.isObject(parsed) ? parsed : {};
  } catch (_) { return {}; }
}

let historySaveTimer = null;
function saveHistory(history) {
  if (historySaveTimer) clearTimeout(historySaveTimer);
  historySaveTimer = setTimeout(() => {
    let raw = JSON.stringify(history);
    if (Buffer.byteLength(raw) > 2 * 1024 * 1024) {
      for (const room of Object.values(history)) {
        if (Array.isArray(room.history)) room.history = room.history.slice(-40);
      }
      raw = JSON.stringify(history);
    }
    try {
      fs.mkdirSync(path.dirname(HISTORY_FILE), { recursive: true, mode: 0o700 });
      fs.writeFileSync(HISTORY_FILE + '.tmp', raw, { mode: 0o600 });
      fs.renameSync(HISTORY_FILE + '.tmp', HISTORY_FILE);
    } catch (_) { /* disk may be read-only */ }
  }, 800);
}

function createServer(options) {
  options = options || {};
  const port = options.port === 0 ? 0 : (Number(options.port) || C.DEFAULT_HTTP_PORT);
  const state = {
    clients: new Map(),
    sessions: new Map(),
    rooms: new Map(),
    files: new Map(),
    dms: new Map(),
    history: loadHistory(),
    network: { name: 'LAN', type: 'unknown', ip: '127.0.0.1' },
    serverId: randomId(8)
  };

  fs.mkdirSync(UPLOAD_DIR, { recursive: true, mode: 0o700 });

  function send(ws, obj) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try { ws.send(JSON.stringify(obj)); } catch (_) { /* ignore */ }
  }
  function error(ws, code, message) { send(ws, { t: 'error', code, message: String(message).slice(0, 200) }); }
  function clientPublic(c) {
    return { id: c.id, name: c.profile.displayName, username: c.username, avatar: c.profile.avatar, status: c.profile.status, accent: c.profile.accent, network: c.network, device: c.device };
  }
  function roomMembers(room) {
    return [...room.members].map((id) => [...state.clients.values()].find((c) => c.id === id)).filter(Boolean);
  }
  function roomSummary(room) {
    return { id: room.id, name: room.name, description: room.description, ownerId: room.ownerId, members: room.members.size, locked: !!room.locked, createdAt: room.createdAt };
  }
  function broadcastAll(obj) {
    const payload = JSON.stringify(obj);
    for (const ws of state.clients.keys()) if (ws.readyState === WebSocket.OPEN) { try { ws.send(payload); } catch (_) { /* ignore */ } }
  }
  function broadcastRoom(roomId, obj, exceptId) {
    const room = state.rooms.get(roomId);
    if (!room) return;
    const payload = JSON.stringify(obj);
    for (const c of roomMembers(room)) {
      if (c.id === exceptId) continue;
      if (c.ws.readyState === WebSocket.OPEN) { try { c.ws.send(payload); } catch (_) { /* ignore */ } }
    }
  }

  function removeClient(ws) {
    const c = state.clients.get(ws);
    if (!c) return;
    state.clients.delete(ws);
    if (c.token) state.sessions.delete(c.token);
    for (const roomId of c.rooms) {
      const room = state.rooms.get(roomId);
      if (!room) continue;
      room.members.delete(c.id);
      if (room.members.size === 0 && room.history.length === 0) state.rooms.delete(roomId);
      else broadcastRoom(roomId, { t: 'peer:left', roomId, id: c.id });
    }
    broadcastAll({ t: 'peer:leave', id: c.id });
    broadcastAll({ t: 'room:list', rooms: [...state.rooms.values()].map(roomSummary) });
  }

  function rateOK(c) {
    const now = Date.now();
    if (now - c.rate.window > C.RATE_WINDOW_MS) { c.rate.window = now; c.rate.count = 0; }
    c.rate.count += 1;
    return c.rate.count <= C.RATE_MAX;
  }

  function handleMessage(ws, msg) {
    const c = state.clients.get(ws);
    if (!c) return;
    if (!c.ready && msg.t !== 'hello') { error(ws, 'not_ready', 'أرسل hello أولاً'); return; }
    if (!rateOK(c)) { error(ws, 'rate_limit', 'طلبات كثيرة جداً'); return; }

    switch (msg.t) {
      case 'ping':
        send(ws, { t: 'pong', ts: msg.ts || Date.now() });
        break;

      case 'hello': {
        if (c.ready) break;
        const id = String(msg.id || '');
        if (!V.id(id) || [...state.clients.values()].some((x) => x.id === id)) { error(ws, 'bad_id', 'معرّف غير صالح'); ws.close(); return; }
        const name = V.safeName(msg.name || msg.username || 'مستخدم', C.MAX_NAME);
        const profile = {
          displayName: name,
          bio: V.cleanText(msg.bio || '', C.MAX_BIO),
          avatar: V.avatar(msg.avatar || ''),
          status: ['online', 'away', 'busy'].includes(msg.status) ? msg.status : 'online',
          accent: /^#[0-9a-fA-F]{6}$/.test(msg.accent || '') ? msg.accent : ''
        };
        c.id = id;
        c.username = V.str(msg.username, 1, 32) ? V.cleanText(msg.username, 32) : name;
        c.profile = profile;
        c.network = V.cleanText(String(msg.network || state.network.name).slice(0, C.MAX_NAME), C.MAX_NAME);
        c.device = V.cleanText(msg.device || 'desktop', 24);
        c.token = randomId(24);
        c.ready = true;
        state.sessions.set(c.token, c.id);
        const peers = [...state.clients.values()].filter((x) => x.ready && x.id !== c.id).map(clientPublic);
        send(ws, {
          t: 'welcome',
          you: clientPublic(c),
          token: c.token,
          peers,
          rooms: [...state.rooms.values()].map(roomSummary),
          network: state.network,
          serverId: state.serverId,
          udp: { host: state.network.ip, port: options.udpPort || C.UDP_VOICE_PORT },
          limits: { maxFile: C.MAX_FILE_BYTES, maxText: C.MAX_TEXT, maxVoice: C.MAX_VOICE_MEMBERS }
        });
        broadcastAll({ t: 'peer:join', peer: clientPublic(c) });
        break;
      }

      case 'profile:update': {
        const p = msg.profile || {};
        c.profile.displayName = V.safeName(p.displayName || c.profile.displayName, C.MAX_DISPLAY);
        c.profile.bio = V.cleanText(p.bio ?? c.profile.bio, C.MAX_BIO);
        c.profile.avatar = V.avatar(p.avatar ?? c.profile.avatar);
        c.profile.status = ['online', 'away', 'busy'].includes(p.status) ? p.status : c.profile.status;
        c.profile.accent = /^#[0-9a-fA-F]{6}$/.test(p.accent || '') ? p.accent : '';
        broadcastAll({ t: 'peer:profile', peer: clientPublic(c) });
        send(ws, { t: 'profile:saved', profile: clientPublic(c) });
        break;
      }

      case 'room:create': {
        if (state.rooms.size >= C.MAX_ROOMS) { error(ws, 'limit', 'عدد الغرف ممتلئ'); break; }
        const name = V.safeName(msg.name, C.MAX_NAME);
        if (!C.ROOM_NAME_RE.test(name)) { error(ws, 'bad_name', 'اسم الغرفة غير صالح'); break; }
        const id = V.id(msg.id, C.ROOM_ID_RE) ? msg.id : 'r-' + randomId(6);
        if (state.rooms.has(id)) { error(ws, 'exists', 'الغرفة موجودة'); break; }
        const room = {
          id, name,
          description: V.cleanText(msg.description || '', 160),
          ownerId: c.id,
          createdAt: Date.now(),
          members: new Set([c.id]),
          history: [],
          locked: !!msg.locked,
          salt: '', pwdHash: ''
        };
        if (room.locked) {
          const pw = V.str(msg.password, 4, 64) ? msg.password : 'wasel';
          room.salt = randomId(8);
          room.pwdHash = crypto.scryptSync(pw, room.salt, 32).toString('hex');
        }
        state.rooms.set(id, room);
        c.rooms.add(id);
        state.history[id] = { name: room.name, history: [] };
        send(ws, { t: 'room:created', room: roomSummary(room) });
        send(ws, { t: 'room:joined', room: roomSummary(room), members: roomMembers(room).map(clientPublic), history: room.history });
        broadcastAll({ t: 'room:list', rooms: [...state.rooms.values()].map(roomSummary) });
        break;
      }

      case 'room:join': {
        const id = String(msg.roomId || '');
        const room = state.rooms.get(id);
        if (!room) { error(ws, 'no_room', 'الغرفة غير موجودة'); break; }
        if (room.members.size >= C.MAX_ROOM_MEMBERS && !room.members.has(c.id)) { error(ws, 'full', 'الغرفة ممتلئة'); break; }
        if (room.locked) {
          const candidate = crypto.scryptSync(String(msg.password || ''), room.salt, 32);
          const expected = Buffer.from(room.pwdHash, 'hex');
          if (candidate.length !== expected.length || !crypto.timingSafeEqual(candidate, expected)) { error(ws, 'bad_password', 'كلمة المرور غير صحيحة'); break; }
        }
        c.rooms.add(id);
        room.members.add(c.id);
        send(ws, { t: 'room:joined', room: roomSummary(room), members: roomMembers(room).map(clientPublic), history: room.history.slice(-C.HISTORY_LIMIT) });
        broadcastRoom(id, { t: 'peer:join-room', roomId: id, peer: clientPublic(c) }, c.id);
        broadcastAll({ t: 'room:list', rooms: [...state.rooms.values()].map(roomSummary) });
        break;
      }

      case 'room:leave': {
        const id = String(msg.roomId || '');
        const room = state.rooms.get(id);
        if (!room || !room.members.has(c.id)) break;
        room.members.delete(c.id);
        c.rooms.delete(id);
        broadcastRoom(id, { t: 'peer:left-room', roomId: id, id: c.id });
        broadcastAll({ t: 'room:list', rooms: [...state.rooms.values()].map(roomSummary) });
        send(ws, { t: 'room:left', roomId: id });
        break;
      }

      case 'room:list':
        send(ws, { t: 'room:list', rooms: [...state.rooms.values()].map(roomSummary) });
        break;

      case 'chat': {
        const roomId = String(msg.roomId || '');
        const room = state.rooms.get(roomId);
        if (!room || !room.members.has(c.id)) { error(ws, 'forbidden', 'لست عضواً في هذه الغرفة'); break; }
        const text = V.cleanText(msg.text || '', C.MAX_TEXT);
        if (!text && !msg.fileId) break;
        const item = {
          id: randomId(8), roomId, from: c.id, author: c.profile.displayName,
          avatar: c.profile.avatar, text,
          fileId: V.id(msg.fileId, /^[a-f0-9]{32}$/) ? msg.fileId : null,
          replyTo: V.id(msg.replyTo, /^[a-f0-9]{16}$/) ? msg.replyTo : null,
          ts: Date.now()
        };
        room.history.push(item);
        if (room.history.length > C.HISTORY_LIMIT) room.history.shift();
        if (!state.history[roomId]) state.history[roomId] = { name: room.name, history: [] };
        state.history[roomId].history = room.history;
        saveHistory(state.history);
        broadcastRoom(roomId, { t: 'chat', message: item });
        break;
      }

      case 'typing':
        if (V.id(String(msg.roomId || ''), C.ROOM_ID_RE) && typeof msg.active === 'boolean') {
          broadcastRoom(msg.roomId, { t: 'typing', roomId: msg.roomId, id: c.id, active: msg.active }, c.id);
        }
        break;

      case 'dm': {
        const to = String(msg.to || '');
        const target = [...state.clients.values()].find((x) => x.id === to && x.ready);
        if (!target || to === c.id) { error(ws, 'no_peer', 'المستخدم غير متصل'); break; }
        const text = V.cleanText(msg.text || '', C.MAX_TEXT);
        if (!text && !msg.fileId) break;
        const key = [c.id, to].sort().join(':');
        const item = { id: randomId(8), from: c.id, to, author: c.profile.displayName, avatar: c.profile.avatar, text, fileId: msg.fileId || null, ts: Date.now() };
        if (!state.dms.has(key)) state.dms.set(key, []);
        const list = state.dms.get(key);
        list.push(item);
        if (list.length > 100) list.shift();
        send(ws, { t: 'dm', message: item });
        send(target.ws, { t: 'dm', message: item });
        break;
      }

      case 'dm:history': {
        const to = String(msg.to || '');
        if (!V.id(to)) break;
        const key = [c.id, to].sort().join(':');
        send(ws, { t: 'dm:history', to, messages: (state.dms.get(key) || []).slice(-100) });
        break;
      }

      case 'signal': {
        const to = String(msg.to || '');
        const target = [...state.clients.values()].find((x) => x.id === to && x.ready);
        if (!target || to === c.id) break;
        if (msg.roomId && !String(msg.roomId).startsWith('dm:') && (!c.rooms.has(msg.roomId) || !target.rooms.has(msg.roomId))) break;
        const data = V.signalData(msg.data);
        send(target.ws, { t: 'signal', from: c.id, roomId: String(msg.roomId || '').slice(0, 48), data });
        break;
      }

      case 'file:notify': {
        const file = state.files.get(String(msg.fileId || ''));
        if (!file || file.ownerId !== c.id) break;
        let allowed = [];
        if (V.id(String(msg.roomId || ''), C.ROOM_ID_RE) && c.rooms.has(msg.roomId)) {
          const room = state.rooms.get(msg.roomId);
          allowed = roomMembers(room).map((x) => x.id);
          for (const id of allowed) file.allowed.add(id);
        } else if (V.id(String(msg.to || '')) && [...state.clients.values()].some((x) => x.id === msg.to)) {
          file.allowed.add(msg.to);
          file.allowed.add(c.id);
          allowed = [...file.allowed];
        }
        file.roomId = msg.roomId || null;
        for (const id of allowed) {
          const client = [...state.clients.values()].find((x) => x.id === id);
          if (client) send(client.ws, { t: 'file:shared', file: fileInfo(file) });
        }
        break;
      }

      default:
        error(ws, 'unknown_type', 'نوع رسالة غير معروف');
    }
  }

  function fileInfo(file) {
    return { id: file.id, name: file.name, size: file.size, mime: file.mime, from: file.ownerId, roomId: file.roomId, token: file.token, ts: file.createdAt };
  }

  function securityHeaders(res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', CSP);
  }

  function isAllowedOrigin(req) {
    const origin = req.headers.origin;
    if (!origin) return true;
    try {
      const parsed = new URL(origin);
      const requestHost = String(req.headers.host || '').toLowerCase();
      const originHost = parsed.host.toLowerCase();
      const hostname = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
      if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') return true;
      if (originHost === requestHost) return true;
      const requestHostname = requestHost.replace(/:\d+$/, '').replace(/^\[|\]$/g, '').toLowerCase();
      return hostname === requestHostname;
    } catch (_) {
      return false;
    }
  }

  function json(res, code, obj) {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(obj));
  }

  function serveStatic(req, res, url) {
    let pathname;
    try { pathname = decodeURIComponent(url.pathname); } catch (_) { res.writeHead(400); return res.end(); }
    if (pathname.includes('\0') || pathname.includes('..')) { res.writeHead(403); return res.end('Forbidden'); }
    if (pathname === '/') pathname = '/index.html';
    const target = path.resolve(RENDERER_DIR, '.' + pathname);
    if (target !== RENDERER_DIR && !target.startsWith(RENDERER_DIR + path.sep)) { res.writeHead(403); return res.end('Forbidden'); }
    let filePath = target;
    try {
      if (fs.statSync(filePath).isDirectory()) filePath = path.join(filePath, 'index.html');
    } catch (_) { res.writeHead(404); return res.end('Not found'); }
    if (!C.ALLOWED_STATIC.test(filePath) || !fs.existsSync(filePath)) { res.writeHead(404); return res.end('Not found'); }
    securityHeaders(res);
    res.setHeader('Content-Type', MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream');
    res.setHeader('Cache-Control', pathname.startsWith('/js/') ? 'no-cache' : 'public, max-age=300');
    fs.createReadStream(filePath).on('error', () => res.end()).pipe(res);
  }

  function handleUpload(req, res, url) {
    const token = String(req.headers['x-wasel-token'] || '');
    const clientId = state.sessions.get(token);
    const client = [...state.clients.values()].find((c) => c.id === clientId && c.ready);
    if (!client) return json(res, 401, { ok: false, error: 'invalid session' });
    const name = V.filename(V.decodeHeaderValue(req.headers['x-wasel-name'] || '') || 'file');
    const size = Number(req.headers['x-wasel-size']);
    if (!Number.isInteger(size) || size < 0 || size > C.MAX_FILE_BYTES) return json(res, 413, { ok: false, error: 'file too large' });
    const roomId = String(req.headers['x-wasel-room'] || '');
    const to = String(req.headers['x-wasel-to'] || '');
    if (roomId && (!client.rooms.has(roomId) || !state.rooms.has(roomId))) return json(res, 403, { ok: false, error: 'not a room member' });
    const mime = /^[a-z0-9.+/-]{1,80}$/i.test(String(req.headers['x-wasel-mime'] || '')) ? String(req.headers['x-wasel-mime']) : 'application/octet-stream';
    const id = randomId(16);
    const temp = path.join(UPLOAD_DIR, id + '.part');
    const final = path.join(UPLOAD_DIR, id + '.bin');
    let received = 0;
    let aborted = false;
    const out = fs.createWriteStream(temp, { mode: 0o600, flags: 'wx' });
    req.on('data', (chunk) => {
      received += chunk.length;
      if (received > size || received > C.MAX_FILE_BYTES) { aborted = true; req.destroy(); out.destroy(); }
    });
    req.on('error', () => { aborted = true; });
    out.on('error', () => { aborted = true; });
    req.pipe(out);
    out.on('finish', () => {
      if (aborted || received !== size) {
        try { fs.unlinkSync(temp); } catch (_) { /* ignore */ }
        if (!res.headersSent) json(res, 400, { ok: false, error: 'upload incomplete' });
        return;
      }
      try {
        fs.renameSync(temp, final);
        const file = {
          id, name, size, mime, ownerId: client.id, roomId: roomId || null,
          allowed: new Set(roomId ? roomMembers(state.rooms.get(roomId)).map((x) => x.id) : [client.id, to]),
          token: randomId(24), path: final, createdAt: Date.now(), expires: Date.now() + C.FILE_TTL_MS
        };
        state.files.set(id, file);
        json(res, 200, { ok: true, ...fileInfo(file) });
      } catch (_) {
        json(res, 500, { ok: false, error: 'storage error' });
      }
    });
  }

  function handleDownload(req, res, url) {
    const id = String(url.searchParams.get('id') || '');
    const token = String(url.searchParams.get('token') || '');
    const file = state.files.get(id);
    if (!file || token !== file.token || Date.now() > file.expires || !fs.existsSync(file.path)) return json(res, 404, { ok: false, error: 'not found or expired' });
    securityHeaders(res);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', "attachment; filename*=UTF-8''" + encodeURIComponent(file.name));
    res.setHeader('Content-Length', String(file.size));
    res.setHeader('Cache-Control', 'no-store');
    fs.createReadStream(file.path).on('error', () => res.end()).pipe(res);
  }

  const server = http.createServer((req, res) => {
    let url;
    try { url = new URL(req.url, 'http://localhost'); } catch (_) { res.writeHead(400); return res.end(); }
    if (!isAllowedOrigin(req)) { res.writeHead(403); return res.end('Forbidden'); }
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'content-type, x-wasel-token, x-wasel-name, x-wasel-size, x-wasel-mime, x-wasel-room, x-wasel-to',
        'Access-Control-Max-Age': '600'
      });
      return res.end();
    }
    if (url.pathname.startsWith('/api/')) res.setHeader('Access-Control-Allow-Origin', '*');
    if (url.pathname === '/api/health') return json(res, 200, { ok: true, app: C.APP_ID, version: C.VERSION });
    if (url.pathname === '/api/info') return json(res, 200, {
      app: C.APP_ID, version: C.VERSION, protocol: C.PROTOCOL_VERSION,
      network: state.network, users: state.clients.size,
      rooms: [...state.rooms.values()].map(roomSummary),
      serverId: state.serverId, udp: { host: state.network.ip, port: options.udpPort || C.UDP_VOICE_PORT }
    });
    if (url.pathname === '/api/upload' && req.method === 'POST') return handleUpload(req, res, url);
    if (url.pathname === '/api/download' && req.method === 'GET') return handleDownload(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    return serveStatic(req, res, url);
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024, perMessageDeflate: false });
  server.on('upgrade', (req, socket, head) => {
    let url;
    try { url = new URL(req.url, 'http://localhost'); } catch (_) { socket.destroy(); return; }
    if (url.pathname !== '/ws') { socket.destroy(); return; }
    if (!isAllowedOrigin(req)) { socket.destroy(); return; }
    if (state.clients.size >= C.MAX_CLIENTS) { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, (ws) => {
      const client = {
        ws, id: '', username: '', token: '', ready: false, rooms: new Set(),
        profile: { displayName: 'مستخدم', avatar: '', status: 'online', bio: '', accent: '' },
        network: '', device: '', rate: { count: 0, window: Date.now() }, alive: true
      };
      state.clients.set(ws, client);
      const helloTimeout = setTimeout(() => { if (!client.ready) ws.close(); }, C.WS_HELLO_TIMEOUT_MS);
      ws.on('close', () => { clearTimeout(helloTimeout); removeClient(ws); });
      ws.on('error', () => { clearTimeout(helloTimeout); removeClient(ws); });
      ws.on('pong', () => { client.alive = true; });
      ws.on('message', (raw, isBinary) => {
        if (isBinary || raw.length > 256 * 1024) { error(ws, 'bad_frame', 'frame too large'); return; }
        let msg;
        try { msg = V.json(raw.toString('utf8'), 256 * 1024); }
        catch (e) { error(ws, 'bad_json', e instanceof RangeError ? 'frame too large' : 'invalid json'); return; }
        try { handleMessage(ws, msg); }
        catch (e) { error(ws, 'invalid', e && e.message ? e.message : 'invalid message'); }
      });
    });
  });

  const heartbeat = setInterval(() => {
    for (const [ws, client] of state.clients) {
      if (!client.alive) { ws.terminate(); removeClient(ws); continue; }
      client.alive = false;
      try { ws.ping(); } catch (_) { /* ignore */ }
    }
  }, C.WS_HEARTBEAT_MS);

  const fileCleaner = setInterval(() => {
    const now = Date.now();
    for (const [id, file] of state.files) {
      if (now <= file.expires) continue;
      state.files.delete(id);
      try { fs.unlinkSync(file.path); } catch (_) { /* ignore */ }
    }
  }, 60000);

  let udpRelay = null;
  function startUdp() {
    if (!udpRelay) { udpRelay = new UdpVoiceRelay(); udpRelay.start(options.udpPort || C.UDP_VOICE_PORT); }
    return udpRelay;
  }

  async function listen() {
    state.network = await getNetworkInfo();
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '0.0.0.0', resolve);
    });
    startUdp();
    return { port: server.address().port, network: state.network };
  }

  function close() {
    clearInterval(heartbeat);
    clearInterval(fileCleaner);
    if (historySaveTimer) clearTimeout(historySaveTimer);
    for (const ws of state.clients.keys()) { try { ws.close(); } catch (_) { /* ignore */ } }
    try { wss.close(); } catch (_) { /* ignore */ }
    if (udpRelay) udpRelay.stop();
    try { server.closeAllConnections?.(); } catch (_) { /* ignore */ }
    return new Promise((resolve) => server.close(() => resolve()));
  }

  return { server, wss, state, listen, close, startUdp, send, broadcastAll, broadcastRoom, error };
}

if (require.main === module) {
  const port = Number(process.env.WASEL_PORT || process.env.PORT) || C.DEFAULT_HTTP_PORT;
  const app = createServer({ port });
  app.listen().then(({ port: actual, network }) => {
    console.log(`مكالمات واصل ${C.VERSION} running on http://0.0.0.0:${actual}`);
    console.log(`Network: ${network.name} (${network.type}) - ${network.ip}`);
  }).catch((err) => { console.error('Failed to start:', err.message); process.exit(1); });
  const shutdown = () => app.close().then(() => process.exit(0));
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

module.exports = { createServer };
