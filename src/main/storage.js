'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const C = require('../shared/constants');
const V = require('../shared/validate');

let dataDir = '';
let dataFile = '';
let cache = null;
let safeStorage = null;

function init(dir) {
  dataDir = dir;
  dataFile = path.join(dir, 'wasel-call.json');
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  try {
    const electron = require('electron');
    if (electron && electron.safeStorage && electron.app.isReady()) safeStorage = electron.safeStorage;
  } catch (_) {
    safeStorage = null;
  }
  load();
}

function blank() {
  return { version: 1, accounts: [], settings: {} };
}

function decode(text) {
  if (!text) return blank();
  try {
    let raw = text;
    if (safeStorage && safeStorage.isEncryptionAvailable()) {
      try {
        raw = safeStorage.decryptString(Buffer.from(text, 'base64'));
      } catch (_) {
        return blank();
      }
    }
    const parsed = JSON.parse(raw);
    if (!V.isObject(parsed) || !Array.isArray(parsed.accounts)) return blank();
    return { version: 1, accounts: parsed.accounts.slice(0, 20), settings: V.isObject(parsed.settings) ? parsed.settings : {} };
  } catch (_) {
    return blank();
  }
}

function load() {
  if (!dataFile) throw new Error('storage not initialized');
  try {
    cache = decode(fs.readFileSync(dataFile, 'utf8'));
  } catch (_) {
    cache = blank();
  }
  return cache;
}

function persist() {
  let raw = JSON.stringify(cache);
  if (safeStorage && safeStorage.isEncryptionAvailable()) raw = safeStorage.encryptString(raw).toString('base64');
  const tmp = dataFile + '.tmp';
  fs.writeFileSync(tmp, raw, { mode: 0o600 });
  fs.renameSync(tmp, dataFile);
}

function getAccounts() {
  return (cache || load()).accounts.map((a) => ({
    username: a.username,
    profile: { ...a.profile },
    createdAt: a.createdAt
  }));
}

function normUsername(username) {
  if (typeof username !== 'string' || !C.USERNAME_RE.test(username)) throw new TypeError('اسم المستخدم غير صالح');
  return username.trim();
}

function hashPassword(password, salt) {
  return crypto.scryptSync(String(password), salt, 64).toString('hex');
}

function signup(username, password, profile) {
  const name = normUsername(username);
  if (typeof password !== 'string' || password.length < 6 || password.length > 128) throw new TypeError('كلمة المرور يجب أن تكون 6 أحرف على الأقل');
  if (cache.accounts.length >= 20) throw new RangeError('تم الوصول للحد الأقصى للحسابات');
  if (cache.accounts.some((a) => a.username.toLowerCase() === name.toLowerCase())) throw new Error('اسم المستخدم مستخدم بالفعل');
  const salt = crypto.randomBytes(16).toString('hex');
  const account = {
    username: name,
    salt,
    hash: hashPassword(password, salt),
    createdAt: Date.now(),
    profile: sanitizeProfile(profile || {})
  };
  cache.accounts.push(account);
  persist();
  return { username: name, profile: account.profile };
}

function sanitizeProfile(profile) {
  if (!V.isObject(profile)) throw new TypeError('bad profile');
  return {
    displayName: V.safeName(profile.displayName || profile.username || 'مستخدم', C.MAX_DISPLAY),
    bio: profile.bio ? V.cleanText(profile.bio, C.MAX_BIO) : '',
    avatar: V.avatar(profile.avatar || ''),
    status: ['online', 'away', 'busy'].includes(profile.status) ? profile.status : 'online',
    accent: /^#[0-9a-fA-F]{6}$/.test(profile.accent || '') ? profile.accent : ''
  };
}

function login(username, password) {
  const name = normUsername(username);
  const account = cache.accounts.find((a) => a.username.toLowerCase() === name.toLowerCase());
  if (!account || typeof password !== 'string') throw new Error('اسم المستخدم أو كلمة المرور غير صحيحة');
  const actual = Buffer.from(account.hash, 'hex');
  const supplied = Buffer.from(hashPassword(password, account.salt), 'hex');
  if (actual.length !== supplied.length || !crypto.timingSafeEqual(actual, supplied)) {
    throw new Error('اسم المستخدم أو كلمة المرور غير صحيحة');
  }
  return { username: account.username, profile: { ...account.profile } };
}

function updateProfile(username, patch) {
  const account = cache.accounts.find((a) => a.username === username);
  if (!account) throw new Error('الحساب غير موجود');
  account.profile = sanitizeProfile({ ...account.profile, ...patch, username: account.username });
  persist();
  return { username: account.username, profile: { ...account.profile } };
}

function changePassword(username, oldPassword, newPassword) {
  const account = cache.accounts.find((a) => a.username === username);
  if (!account) throw new Error('الحساب غير موجود');
  login(username, oldPassword);
  if (typeof newPassword !== 'string' || newPassword.length < 6 || newPassword.length > 128) throw new TypeError('كلمة المرور ضعيفة');
  account.salt = crypto.randomBytes(16).toString('hex');
  account.hash = hashPassword(newPassword, account.salt);
  persist();
  return true;
}

function deleteAccount(username, password) {
  login(username, password);
  cache.accounts = cache.accounts.filter((a) => a.username !== username);
  persist();
  return true;
}

function getSetting(key, fallback) {
  const value = (cache || load()).settings[key];
  return value === undefined ? fallback : value;
}

function setSetting(key, value) {
  const safeKeys = ['theme', 'accent', 'language', 'host', 'session', 'voiceMode', 'udpVoice', 'micSensitivity', 'noiseGate', 'echoCancel', 'minimizeToTray', 'volume', 'lastRoom'];
  if (!safeKeys.includes(key)) throw new TypeError('bad setting key');
  if (typeof value === 'string' && value.length > 512) throw new RangeError('setting too long');
  cache.settings[key] = value;
  persist();
  return value;
}

module.exports = {
  init, getAccounts, signup, login, updateProfile, changePassword, deleteAccount,
  getSetting, setSetting
};
