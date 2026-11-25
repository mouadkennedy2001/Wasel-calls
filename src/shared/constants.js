(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WaselConstants = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  return {
    APP_ID: 'wasel-call',
    APP_NAME: 'مكالمات واصل',
    VERSION: '1.0.0',
    PROTOCOL_VERSION: 1,
    DEFAULT_HTTP_PORT: 7788,
    DISCOVERY_PORT: 7789,
    UDP_VOICE_PORT: 7790,
    DISCOVERY_MAGIC: 'WASEL1',
    VOICE_MAGIC: 0x57,
    MAX_TEXT: 4000,
    MAX_NAME: 48,
    MAX_DISPLAY: 48,
    MAX_BIO: 280,
    MAX_AVATAR_BYTES: 256 * 1024,
    MAX_FILE_BYTES: 200 * 1024 * 1024,
    MAX_ROOMS: 64,
    MAX_ROOM_MEMBERS: 12,
    MAX_VOICE_MEMBERS: 12,
    MAX_CLIENTS: 200,
    MAX_PEERS: 80,
    HISTORY_LIMIT: 200,
    RATE_WINDOW_MS: 10000,
    RATE_MAX: 140,
    WS_HEARTBEAT_MS: 30000,
    WS_HELLO_TIMEOUT_MS: 15000,
    FILE_TTL_MS: 60 * 60 * 1000,
    ID_RE: /^[A-Za-z0-9_-]{8,64}$/,
    ROOM_ID_RE: /^[A-Za-z0-9_-]{4,48}$/,
    USERNAME_RE: /^[\p{L}\p{N}_.]{3,32}$/u,
    ROOM_NAME_RE: /^[\p{L}\p{N} _'-]{2,64}$/u,
    ALLOWED_STATIC: /\.(html|css|js|mjs|json|svg|png|jpg|jpeg|webp|ico|woff2?|map)$/i
  };
});
