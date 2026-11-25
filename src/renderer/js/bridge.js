import { t } from './i18n.js';

const native = typeof window !== 'undefined' ? window.wasel : null;
const PREFIX = 'wasel.';
const ACCOUNTS_KEY = 'wasel.accounts.v1';

function uid() {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch (_) { return fallback; }
}

function writeJSON(key, value) {
  localStorage.setItem(PREFIX + key, JSON.stringify(value));
}

function cleanProfile(profile) {
  profile = profile || {};
  return {
    displayName: String(profile.displayName || '').slice(0, 48).trim() || 'مستخدم',
    bio: String(profile.bio || '').slice(0, 280).trim(),
    avatar: typeof profile.avatar === 'string' && profile.avatar.startsWith('data:image/') ? profile.avatar.slice(0, 300000) : '',
    status: ['online', 'away', 'busy'].includes(profile.status) ? profile.status : 'online',
    accent: /^#[0-9a-f]{6}$/i.test(profile.accent || '') ? profile.accent : ''
  };
}

async function derive(password, salt) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations: 150000 }, key, 256);
  return Array.from(new Uint8Array(bits), (b) => b.toString(16).padStart(2, '0')).join('');
}

function browserAuth() {
  function accounts() {
    return (readJSON(ACCOUNTS_KEY, []) || []).map((a) => ({ username: a.username, profile: a.profile, createdAt: a.createdAt }));
  }
  return {
    accounts,
    async signup(username, password, profile) {
      const name = String(username || '').trim();
      if (!/^[\p{L}\p{N}_.]{3,32}$/u.test(name)) throw new Error(t('invalidUsername'));
      if (String(password || '').length < 6) throw new Error(t('weakPassword'));
      const list = readJSON(ACCOUNTS_KEY, []) || [];
      if (list.some((a) => a.username.toLowerCase() === name.toLowerCase())) throw new Error(t('accountExists'));
      if (list.length >= 20) throw new Error(t('failure'));
      const salt = uid();
      const account = { username: name, salt, hash: await derive(password, salt), createdAt: Date.now(), profile: cleanProfile({ ...profile, displayName: profile.displayName || name }) };
      list.push(account);
      writeJSON(ACCOUNTS_KEY, list);
      return { username: name, profile: account.profile };
    },
    async login(username, password) {
      const list = readJSON(ACCOUNTS_KEY, []) || [];
      const account = list.find((a) => a.username.toLowerCase() === String(username || '').toLowerCase());
      if (!account) throw new Error(t('wrongCredentials'));
      if (await derive(password, account.salt) !== account.hash) throw new Error(t('wrongCredentials'));
      return { username: account.username, profile: account.profile };
    },
    async updateProfile(username, patch) {
      const list = readJSON(ACCOUNTS_KEY, []) || [];
      const account = list.find((a) => a.username === username);
      if (!account) throw new Error(t('failure'));
      account.profile = cleanProfile({ ...account.profile, ...patch });
      writeJSON(ACCOUNTS_KEY, list);
      return { username, profile: account.profile };
    },
    async changePassword(username, oldPassword, newPassword) {
      const list = readJSON(ACCOUNTS_KEY, []) || [];
      const account = list.find((a) => a.username === username);
      if (!account || await derive(oldPassword, account.salt) !== account.hash) throw new Error(t('wrongCredentials'));
      if (String(newPassword || '').length < 6) throw new Error(t('weakPassword'));
      account.salt = uid();
      account.hash = await derive(newPassword, account.salt);
      writeJSON(ACCOUNTS_KEY, list);
      return true;
    },
    async remove(username, password) {
      const list = readJSON(ACCOUNTS_KEY, []) || [];
      const account = list.find((a) => a.username === username);
      if (!account || await derive(password, account.salt) !== account.hash) throw new Error(t('wrongCredentials'));
      writeJSON(ACCOUNTS_KEY, list.filter((a) => a.username !== username));
      return true;
    }
  };
}

const browserBridge = {
  platform: 'browser',
  app: {
    async info() {
      let network = null;
      try { network = (await (await fetch('/api/info')).json()).network; } catch (_) { /* offline */ }
      return { version: '1.0.0', platform: 'browser', network, isHost: false, deviceId: localStorage.getItem(PREFIX + 'device') || (() => { const id = uid(); localStorage.setItem(PREFIX + 'device', id); return id; })() };
    },
    openExternal: (url) => { try { window.open(url, '_blank', 'noopener,noreferrer'); return true; } catch (_) { return false; } },
    message: async (message) => { window.alert(String(message)); return true; }
  },
  window: { minimize: async () => false, maximize: async () => false, close: async () => false, isMaximized: async () => false },
  store: {
    async get(key, fallback) { const v = readJSON(key, fallback); return v === undefined ? fallback : v; },
    async set(key, value) { writeJSON(key, value); return value; }
  },
  auth: browserAuth(),
  net: {
    async info() {
      try {
        const plugin = window.Capacitor?.Plugins?.WaselDiscovery;
        if (plugin?.getWifiInfo) {
          const native = await plugin.getWifiInfo();
          if (native?.localIp) return { name: native.ssid || 'LAN', type: native.interfaceType || native.type || 'unknown', ip: native.localIp };
        }
      } catch (_) { /* fallback to browser/server info */ }
      try { return (await (await fetch('/api/info')).json()).network; } catch (_) { return null; }
    },
    onDiscovery(callback) {
      const plugin = window.Capacitor?.Plugins?.WaselDiscovery;
      if (!plugin) return () => {};
      let unsubscribe = () => {};
      try {
        const handle = plugin.addListener?.('waselHosts', (data) => callback(data));
        Promise.resolve(handle).then((listener) => {
          unsubscribe = () => listener?.remove?.();
        }).catch(() => {});
        plugin.startDiscovery?.().catch?.(() => {});
        plugin.getHosts?.().then((data) => { if (data) callback(data); }).catch(() => {});
      } catch (_) { /* discovery is optional */ }
      return unsubscribe;
    }
  },
  voice: {
    supported: false,
    udpStart: async () => false,
    udpSend: async () => false,
    udpStop: async () => false,
    onUdpFrame() { return () => {}; }
  },
  theme: {
    onSystem(callback) {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const handler = () => callback(mq.matches ? 'dark' : 'light');
      mq.addEventListener('change', handler);
      return () => mq.removeEventListener('change', handler);
    }
  }
};

export const bridge = native || browserBridge;
export const isDesktop = bridge.platform === 'electron';
