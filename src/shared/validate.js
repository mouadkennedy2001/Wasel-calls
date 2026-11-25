(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WaselValidate = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const C = (typeof module === 'object' && module.exports)
    ? require('./constants')
    : (typeof globalThis !== 'undefined' && globalThis.WaselConstants) || {};

  function isObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function str(value, min, max) {
    return typeof value === 'string' && value.length >= min && value.length <= max;
  }

  function hasOnlyKeys(obj, keys) {
    if (!isObject(obj)) return false;
    const allowed = new Set(keys);
    return Object.keys(obj).every((k) => allowed.has(k));
  }

  function cleanText(input, max) {
    if (typeof input !== 'string') throw new TypeError('text must be a string');
    let out = '';
    for (const ch of input) {
      const code = ch.codePointAt(0);
      if (code === 9 || code === 10 || code === 13 || code >= 32) out += ch;
    }
    out = out.replace(/[\u2028\u2029\u200b-\u200f\u2060\ufeff]/g, '').trim();
    if (out.length > max) throw new RangeError('text too long');
    return out;
  }

  function safeName(input, max) {
    const out = cleanText(input, max).replace(/[\\/:*?"<>|]/g, '');
    if (!out) throw new TypeError('empty name');
    return out;
  }

  function filename(input) {
    if (typeof input !== 'string' || !input.trim()) throw new TypeError('bad filename');
    const base = input.split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f]/g, '').trim();
    if (!base || base === '.' || base === '..' || base.length > 255) throw new TypeError('bad filename');
    return base;
  }

  // HTTP header values must be ASCII. The renderer sends encodeURIComponent(name);
  // keep raw values working for older clients that still send Latin-1 text.
  function decodeHeaderValue(input) {
    const raw = String(input == null ? '' : input);
    if (!raw.includes('%')) return raw;
    try { return decodeURIComponent(raw); } catch (_) { return raw; }
  }

  function id(value, re) {
    return typeof value === 'string' && (re || C.ID_RE || /^[A-Za-z0-9_-]{8,64}$/).test(value);
  }

  function int(value, min, max) {
    return Number.isInteger(value) && value >= min && value <= max;
  }

  function avatar(value) {
    if (value == null || value === '') return '';
    if (typeof value !== 'string' || value.length > C.MAX_AVATAR_BYTES) throw new RangeError('avatar too large');
    if (!/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(value)) throw new TypeError('bad avatar');
    return value;
  }

  function json(raw, maxBytes) {
    if (typeof raw !== 'string') throw new TypeError('bad frame');
    if (Buffer.byteLength ? Buffer.byteLength(raw) > maxBytes : raw.length > maxBytes) throw new RangeError('frame too large');
    const parsed = JSON.parse(raw);
    if (!isObject(parsed) || typeof parsed.t !== 'string' || parsed.t.length > 40) throw new TypeError('bad envelope');
    return parsed;
  }

  function signalData(data) {
    if (!isObject(data) || !str(data.type, 2, 12)) throw new TypeError('bad signal');
    if (data.type === 'sdp') {
      if (!isObject(data.sdp) || !str(data.sdp.type, 2, 10) || !str(data.sdp.sdp, 1, 40000)) throw new TypeError('bad sdp');
      return { type: 'sdp', sdp: { type: data.sdp.type, sdp: data.sdp.sdp } };
    }
    if (data.type === 'ice') {
      if (!isObject(data.candidate) || !str(data.candidate.candidate, 1, 1000)) throw new TypeError('bad ice');
      return { type: 'ice', candidate: {
        candidate: data.candidate.candidate,
        sdpMid: typeof data.candidate.sdpMid === 'string' ? data.candidate.sdpMid.slice(0, 64) : null,
        sdpMLineIndex: int(data.candidate.sdpMLineIndex, 0, 16) ? data.candidate.sdpMLineIndex : null
      } };
    }
    if (data.type === 'call') {
      if (!['voice', 'video'].includes(data.kind) || !str(data.callId, 8, 64)) throw new TypeError('bad call');
      return { type: 'call', kind: data.kind, callId: data.callId };
    }
    if (data.type === 'call-answer') {
      if (!str(data.callId, 8, 64)) throw new TypeError('bad call answer');
      return { type: 'call-answer', callId: data.callId };
    }
    if (data.type === 'call-end') {
      if (!str(data.callId, 8, 64)) throw new TypeError('bad call end');
      return { type: 'call-end', callId: data.callId };
    }
    throw new TypeError('unknown signal');
  }

  return { isObject, str, hasOnlyKeys, cleanText, safeName, filename, decodeHeaderValue, id, int, avatar, json, signalData };
});
