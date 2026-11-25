import { bridge, isDesktop } from './bridge.js';
import { t, setLanguage, getLanguage } from './i18n.js';
import { injectSprite, icon } from './icons.js';
import { esc, $, $$, toast, avatar, statusClass, emptyState, openModal } from './ui.js';
import { initTheme } from './theme.js';
import { showAuth } from './auth.js';
import { net } from './net.js';
import { chat } from './chat.js';
import { initRooms, renderRooms } from './rooms.js';
import { initFiles, renderFiles, download, getFileInfo } from './files.js';
import { renderProfile, renderSettings } from './profile.js';
import { voice } from './voice.js';
import { parseHostPort } from './url.js';

const state = {
  account: null,
  view: 'rooms',
  main: null,
  shell: null
};

const NAV = [
  { id: 'rooms', icon: 'room', label: 'rooms' },
  { id: 'chat', icon: 'chat', label: 'chat' },
  { id: 'network', icon: 'network', label: 'network' },
  { id: 'users', icon: 'users', label: 'users' },
  { id: 'files', icon: 'file', label: 'files' },
  { id: 'profile', icon: 'user', label: 'profile' },
  { id: 'settings', icon: 'settings', label: 'settings' }
];

function detectSystemLanguage() {
  const locales = (navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language]).filter(Boolean);
  return locales.some((locale) => /^ar(?:[-_]|$)/i.test(locale)) ? 'ar' : 'en';
}

async function boot() {
  injectSprite();
  const storedLang = await bridge.store.get('language', null).catch(() => null);
  const lang = storedLang === 'ar' || storedLang === 'en' ? storedLang : detectSystemLanguage();
  await bridge.store.set('language', lang).catch(() => {});
  setLanguage(lang);
  await initTheme();
  initRooms();
  initFiles();

  let accounts = [];
  try { accounts = await bridge.auth.accounts(); } catch (_) { /* ignore */ }
  let session = await bridge.store.get('session', '').catch(() => '');
  let account = accounts.find((a) => a.username === session);
  if (!account) {
    showAuth(async (result) => {
      await bridge.store.set('session', result.username).catch(() => {});
      start(result);
    });
    return;
  }
  start(account);
}

function start(account) {
  state.account = account;
  document.body.innerHTML = '';
  const sprite = document.createElement('div');
  sprite.id = 'icon-sprite';
  sprite.className = 'hidden';
  const root = document.createElement('div');
  root.id = 'app-root';
  const toasts = document.createElement('div');
  toasts.id = 'toast-stack';
  toasts.className = 'toast-stack';
  const modalRoot = document.createElement('div');
  modalRoot.id = 'modal-root';
  document.body.append(sprite, root, toasts, modalRoot);
  injectSprite();

  root.innerHTML =
    '<div class="app-shell">' +
      '<header class="titlebar">' +
        '<div class="brand"><span class="brand-icon">' + icon('phone') + '</span><span class="brand-name" data-i18n="appName">' + esc(t('appName')) + '</span></div>' +
        '<div class="titlebar-drag"><span class="titlebar-title" data-title>' + esc(t('rooms')) + '</span></div>' +
        '<div class="connection-status" data-status="offline"><span></span>' + esc(t('disconnected')) + '</div>' +
        (isDesktop ? '<div class="window-controls">' +
          '<button class="win-btn min" data-window="minimize" data-i18n-title="minimize" title="' + esc(t('minimize')) + '">' + icon('minimize') + '</button>' +
          '<button class="win-btn max" data-window="maximize" data-i18n-title="maximize" title="' + esc(t('maximize')) + '">' + icon('maximize') + '</button>' +
          '<button class="win-btn close" data-window="close" data-i18n-title="close" title="' + esc(t('close')) + '">' + icon('close') + '</button>' +
        '</div>' : '') +
      '</header>' +
      '<aside class="sidebar">' +
        '<div class="sidebar-header">' + avatar(account.profile || account) +
          '<div><strong>' + esc(account.profile?.displayName || account.username) + '</strong>' +
          '<small class="mono">@' + esc(account.username) + '</small></div></div>' +
        '<nav class="nav-list">' + NAV.map((item) =>
          '<button class="nav-item ' + (item.id === state.view ? 'active' : '') + '" data-view="' + item.id + '" aria-label="' + esc(t(item.label)) + '">' +
          icon(item.icon) + '<span data-i18n="' + item.label + '">' + esc(t(item.label)) + '</span><span class="nav-badge hidden" data-badge="' + item.id + '"></span></button>'
        ).join('') + '</nav>' +
        '<div class="sidebar-footer">' +
          '<button class="nav-item" data-action="logout">' + icon('logout') + '<span data-i18n="logout">' + esc(t('logout')) + '</span></button>' +
        '</div>' +
      '</aside>' +
      '<main class="main-view" id="main-view"></main>' +
      '<div class="voice-bar" aria-label="' + esc(t('voice')) + '"></div>' +
    '</div>';

  state.shell = $('.app-shell', root);
  state.main = $('#main-view', root);
  chat.mount(state.main);
  voice.attachBar($('.voice-bar', root));
  installEvents(root);
  connect();
  navigate('rooms');
}

async function connect() {
  const saved = await bridge.store.get('host', '').catch(() => '');
  const savedPort = Number(await bridge.store.get('hostPort', 7788).catch(() => 7788)) || 7788;
  let host = '';
  let port = savedPort;
  if (saved) {
    const parsed = parseHostPort(saved, savedPort);
    host = parsed.host;
    port = parsed.port;
  }
  if (isDesktop) {
    const info = await bridge.app.info().catch(() => ({}));
    host = host || '127.0.0.1';
    port = info.port || 7788;
  } else {
    host = host || location.hostname;
    port = Number(location.port) || 7788;
  }
  if (!host) { renderNetwork(); return; }
  let deviceId = await bridge.store.get('deviceId', '').catch(() => '');
  if (!deviceId) {
    const bytes = new Uint8Array(12);
    crypto.getRandomValues(bytes);
    deviceId = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    await bridge.store.set('deviceId', deviceId).catch(() => {});
  }
  const profile = { ...state.account.profile, username: state.account.username, deviceId };
  const ok = await net.connect(host, port, profile);
  if (!ok && isDesktop) toast(t('failure') + ' — ' + t('manualHost'), 'error');
}

function navigate(view) {
  state.view = view;
  const title = state.shell && $('.titlebar-title', state.shell);
  if (title) title.textContent = t(view);
  $$('.nav-item[data-view]').forEach((item) => {
    item.classList.toggle('active', item.dataset.view === view);
    item.setAttribute('aria-current', item.dataset.view === view ? 'page' : 'false');
  });
  if (view === 'rooms') renderRooms(state.main);
  else if (view === 'chat') chat.render();
  else if (view === 'network') renderNetwork();
  else if (view === 'users') renderUsers();
  else if (view === 'files') renderFiles(state.main);
  else if (view === 'profile') renderProfile(state.main, state.account);
  else if (view === 'settings') renderSettings(state.main);
}

function renderNetwork() {
  if (!state.main) return;
  const network = net.network || {};
  const hosts = net.hostCandidates || [];
  state.main.innerHTML =
    '<div class="view">' +
      '<div class="view-header"><div><h1 class="view-title">' + esc(t('network')) + '</h1>' +
      '<p class="view-subtitle">' + esc(t('usersOnNetwork')) + '</p></div>' +
      '<button class="btn secondary" data-net="refresh">' + icon('refresh') + ' ' + esc(t('refresh')) + '</button></div>' +
      '<div class="network-banner">' +
        '<span class="network-icon">' + icon(network.type === 'wifi' ? 'wifi' : 'network', 'icon-lg') + '</span>' +
        '<div><span class="network-name">' + esc(network.name || t('network')) + '</span>' +
        '<small>' + esc(network.type || 'LAN') + ' · ' + esc(network.ip || '') + '</small></div>' +
        '<span class="pill">' + esc(net.connected ? t('connected') : t('disconnected')) + '</span>' +
      '</div>' +
      '<div class="settings-section"><h2>' + icon('monitor') + ' ' + esc(t('manualHost')) + '</h2>' +
        '<div class="setting-row"><input class="host-input" placeholder="' + esc(t('hostAddress')) + '" value="' + esc(net.host || '') + '">' +
        '<button class="btn primary" data-net="connect">' + icon('link') + ' ' + esc(t('connect')) + '</button></div>' +
      '</div>' +
      '<div class="settings-section"><h2>' + icon('network') + ' ' + esc(t('discover')) + '</h2>' +
        (hosts.length ? '<div class="user-grid">' + hosts.map((h) =>
          '<div class="user-card"><span class="network-icon">' + icon('monitor') + '</span>' +
          '<div><strong>' + esc(h.name) + '</strong><small class="mono">' + esc(h.address) + ':' + esc(h.port) + '</small></div>' +
          '<button class="btn secondary" data-net-host="' + esc(h.address) + '" data-net-port="' + esc(h.port) + '">' + esc(t('connect')) + '</button></div>'
        ).join('') + '</div>' : emptyState('network', t('emptyNetwork'))) +
      '</div>' +
      '<div class="settings-section"><h2>' + icon('shield') + ' ' + esc(t('security')) + '</h2>' +
        '<p class="muted">' + esc(t('aboutText')) + '</p></div>' +
    '</div>';

  $('[data-net="connect"]', state.main).addEventListener('click', () => {
    const value = $('.host-input', state.main).value.trim();
    if (!value) return;
    const { host, port } = parseHostPort(value, net.port || 7788);
    bridge.store.set('host', host).catch(() => {});
    bridge.store.set('hostPort', port).catch(() => {});
    net.connect(host, port, { ...state.account.profile, username: state.account.username }).then((ok) => {
      if (ok) toast(t('connected'), 'success');
    });
  });
  $('[data-net="refresh"]', state.main).addEventListener('click', () => renderNetwork());
  $$('[data-net-host]', state.main).forEach((button) => {
    button.addEventListener('click', () => {
      const host = button.dataset.netHost;
      const port = Number(button.dataset.netPort) || 7788;
      bridge.store.set('host', host).catch(() => {});
      bridge.store.set('hostPort', port).catch(() => {});
      net.connect(host, port, { ...state.account.profile, username: state.account.username });
    });
  });
}

function renderUsers() {
  const peers = [...net.peers.values()];
  state.main.innerHTML =
    '<div class="view">' +
      '<div class="view-header"><div><h1 class="view-title">' + esc(t('users')) + '</h1>' +
      '<p class="view-subtitle">' + esc(peers.length + ' ' + t('online')) + '</p></div></div>' +
      (peers.length ? '<div class="user-grid">' + peers.map((peer) =>
        '<div class="user-card">' + avatar(peer) +
          '<div class="member-info"><strong class="member-name">' + esc(peer.displayName || peer.name) + '</strong>' +
          '<small class="member-status ' + statusClass(peer.status) + '">' + esc(t(peer.status || 'online')) + '</small></div>' +
          '<div class="user-card-actions">' +
            '<button class="icon-btn" data-user="profile" data-id="' + esc(peer.id) + '" title="' + esc(t('viewProfile')) + '">' + icon('user') + '</button>' +
            '<button class="icon-btn active" data-user="dm" data-id="' + esc(peer.id) + '" title="' + esc(t('startPrivateChat')) + '">' + icon('chat') + '</button>' +
          '</div></div>'
      ).join('') + '</div>' : emptyState('users', t('noUsers'))) +
    '</div>';
  $$('[data-user="dm"]', state.main).forEach((b) => b.addEventListener('click', () => { chat.openDM(b.dataset.id); navigate('chat'); }));
  $$('[data-user="profile"]', state.main).forEach((b) => b.addEventListener('click', () => {
    import('./profile.js').then((m) => m.showPeerProfile(b.dataset.id));
  }));
}

function installEvents(root) {
  root.addEventListener('click', (e) => {
    const nav = e.target.closest('[data-view]');
    if (nav) { navigate(nav.dataset.view); return; }
    if (e.target.closest('[data-action="logout"]')) {
      bridge.store.set('session', '').catch(() => {});
      net.disconnect();
      voice.leave();
      location.reload();
      return;
    }
    const win = e.target.closest('[data-window]');
    if (win) { bridge.window[win.dataset.window]().catch(() => {}); return; }
    const voiceBtn = e.target.closest('[data-voice]');
    if (voiceBtn) {
      if (voiceBtn.dataset.voice === 'mute') voice.toggleMute();
      else if (voice.active) voice.leave();
      else if (chat.context?.type === 'room') voice.join(chat.context.id);
      else toast(t('selectRoom'), 'info');
      return;
    }
    const chatAction = e.target.closest('[data-chat-action]');
    if (chatAction) { chat.handleAction(chatAction.dataset.chatAction); return; }
    const fileButton = e.target.closest('[data-download]');
    if (fileButton) {
      const file = getFileInfo(fileButton.dataset.download);
      if (file) download(file);
      return;
    }
  });

  document.addEventListener('wasel:upload-progress', (e) => {
    toast(`${t('uploading')} ${e.detail.name} — ${e.detail.pct}%`, 'info');
  });

  // Language changes must reach the whole shell, not only the settings view.
  window.addEventListener('wasel:language', () => {
    $$('[data-i18n]').forEach((node) => { node.textContent = t(node.dataset.i18n); });
    $$('[data-i18n-title]').forEach((node) => { node.title = t(node.dataset.i18nTitle); });
    if (!state.shell) return;
    const title = $('.titlebar-title', state.shell);
    if (title) title.textContent = t(state.view);
    const status = $('.connection-status', state.shell);
    if (status) status.innerHTML = '<span></span>' + esc(t(status.dataset.status === 'connected' ? 'connected' : status.dataset.status === 'reconnecting' ? 'reconnecting' : status.dataset.status === 'connecting' ? 'connecting' : 'disconnected'));
    navigate(state.view);
    voice.render();
  });

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if (state.view !== 'rooms') navigate('rooms');
      setTimeout(() => $('.rooms-filter')?.focus(), 60);
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) {
      const index = Number(e.key) - 1;
      if (index >= 0 && index < NAV.length) {
        e.preventDefault();
        navigate(NAV[index].id);
      }
    }
  });

  net.on('status', (status) => {
    const node = $('.connection-status');
    if (!node) return;
    node.dataset.status = status;
    node.innerHTML = '<span></span>' + esc(status === 'connected' ? t('connected') : status === 'reconnecting' ? t('reconnecting') : status === 'connecting' ? t('connecting') : t('disconnected'));
    if (state.view === 'network') renderNetwork();
  });
  net.on('discovery', () => { if (state.view === 'network') renderNetwork(); });
  net.on('room:joined', () => navigate('chat'));
  net.on('rooms', () => { if (state.view === 'rooms' && !chat.context) renderRooms(state.main); });
  net.on('peers', () => { if (state.view === 'users') renderUsers(); if (state.view === 'network') renderNetwork(); });
  net.on('server-error', (msg) => {
    if (msg.code === 'bad_password') toast(t('wrongRoomPassword'), 'error');
    else if (msg.code === 'full') toast(t('roomFull'), 'error');
    else if (msg.code === 'exists') toast(t('roomExists'), 'error');
  });
  chat.onUnread = (counts) => {
    const total = Object.values(counts).reduce((sum, count) => sum + (Number(count) || 0), 0);
    $$('[data-badge]').forEach((badge) => {
      // Badges live on navigation entries, not on room/dm conversation keys.
      const value = badge.dataset.badge === 'chat' ? total : 0;
      badge.textContent = value > 9 ? '9+' : String(value);
      badge.classList.toggle('hidden', value === 0);
      badge.setAttribute('aria-label', `${t('unread')}: ${value}`);
    });
  };
}

boot().catch((err) => {
  console.error(err);
  document.getElementById('app-root').innerHTML = '<div class="auth-screen"><div class="auth-card"><h1 class="auth-title">' + esc(t('failure')) + '</h1><p>' + esc(err.message || '') + '</p></div></div>';
});
