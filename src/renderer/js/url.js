/* Shared URL helpers for WebSocket / file API endpoints.
   Keeps IPv6 hosts valid inside URLs and respects the page protocol. */

export function normalizeHost(host) {
  return String(host || '').trim().replace(/^\[|\]$/g, '');
}

export function formatHost(host) {
  const raw = normalizeHost(host);
  return raw.includes(':') ? `[${raw}]` : raw;
}

export function parseHostPort(value, fallbackPort) {
  const raw = String(value || '').trim();
  if (!raw) return { host: '', port: Number(fallbackPort) || 7788 };
  if (raw.startsWith('[')) {
    const end = raw.indexOf(']');
    if (end > 0) {
      const host = raw.slice(1, end);
      const port = Number(raw.slice(end + 1).replace(/^:/, '')) || Number(fallbackPort) || 7788;
      return { host, port };
    }
  }
  const colon = raw.lastIndexOf(':');
  if (colon > -1 && raw.indexOf(':') === colon) {
    const port = Number(raw.slice(colon + 1));
    if (port > 0 && port < 65536) return { host: raw.slice(0, colon), port };
  }
  return { host: raw, port: Number(fallbackPort) || 7788 };
}

export function socketURL(host, port) {
  const protocol = typeof location !== 'undefined' && location.protocol === 'https:' ? 'wss' : 'ws';
  return `${protocol}://${formatHost(host)}:${Number(port) || 7788}/ws`;
}

export function httpBase(host, port) {
  const protocol = typeof location !== 'undefined' && location.protocol === 'https:' ? 'https' : 'http';
  const hostname = formatHost(host || (typeof location !== 'undefined' ? location.hostname : '127.0.0.1'));
  return `${protocol}://${hostname}:${Number(port) || 7788}`;
}
