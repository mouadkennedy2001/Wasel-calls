import { bridge, isDesktop } from './bridge.js';
import { net } from './net.js';
import { voice } from './voice.js';
import { t, getLanguage, setLanguage } from './i18n.js';
import { icon } from './icons.js';
import { esc, $, toast, avatar, statusClass, openModal, confirmDialog } from './ui.js';
import { THEMES, themeGrid, applyTheme, getTheme, setAccent, getAccent } from './theme.js';
import { exportSettings, importSettings } from './settingsBackup.js';

let profileContainer = null;
let settingsContainer = null;
let draftAvatar = '';

export async function renderProfile(node, account) {
  profileContainer = node;
  if (!node) return;
  draftAvatar = account.profile?.avatar || '';
  const p = account.profile || {};
  node.innerHTML =
    '<div class="view">' +
      '<div class="profile-hero">' +
        '<div class="profile-cover" style="background:linear-gradient(135deg, var(--accent), var(--bg-3))"></div>' +
        '<div class="profile-head">' +
          '<div class="avatar-picker">' + avatar({ displayName: p.displayName || account.username, avatar: draftAvatar }, 'profile-avatar') +
            '<button class="icon-btn" data-profile="avatar" title="' + esc(t('chooseImage')) + '">' + icon('image') + '</button></div>' +
          '<div class="profile-details"><h1 class="profile-name">' + esc(p.displayName || account.username) + '</h1>' +
            '<p class="profile-handle mono">@' + esc(account.username) + '</p>' +
            '<span class="pill ' + statusClass(p.status) + '">' + esc(t(p.status || 'online')) + '</span></div>' +
        '</div>' +
      '</div>' +
      '<form class="profile-form">' +
        '<div class="field"><label>' + esc(t('displayName')) + '</label><input name="displayName" maxlength="48" value="' + esc(p.displayName || '') + '"></div>' +
        '<div class="field"><label>' + esc(t('bio')) + '</label><textarea name="bio" rows="3" maxlength="280">' + esc(p.bio || '') + '</textarea></div>' +
        '<div class="field"><label>' + esc(t('status')) + '</label><select name="status">' +
          ['online', 'away', 'busy'].map((s) => '<option value="' + s + '" ' + (p.status === s ? 'selected' : '') + '>' + esc(t(s)) + '</option>').join('') +
        '</select></div>' +
        '<div class="field"><label>' + esc(t('accent') || 'Accent') + '</label><input type="color" name="accent" value="' + esc(p.accent || getAccent() || '#3584e4') + '"></div>' +
        '<div class="profile-actions">' +
          '<button type="submit" class="btn primary">' + icon('check') + ' ' + esc(t('save')) + '</button>' +
          '<button type="button" class="btn secondary" data-profile="password">' + icon('key') + ' ' + esc(t('changePassword')) + '</button>' +
          '<button type="button" class="btn ghost danger-text" data-profile="delete">' + icon('trash') + ' ' + esc(t('deleteAccount')) + '</button>' +
        '</div>' +
      '</form>' +
      '<div class="profile-stats">' +
        '<div class="stat"><strong>' + esc(net.peers.size) + '</strong><span>' + esc(t('users')) + '</span></div>' +
        '<div class="stat"><strong>' + esc(net.rooms.size) + '</strong><span>' + esc(t('rooms')) + '</span></div>' +
        '<div class="stat"><strong>LAN</strong><span>' + esc(t('network')) + '</span></div>' +
      '</div>' +
    '</div>';

  $('[data-profile="avatar"]', node).addEventListener('click', () => pickAvatar(account));
  const form = $('form', node);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = new FormData(form);
    const patch = {
      displayName: String(data.get('displayName') || '').trim(),
      bio: String(data.get('bio') || '').trim(),
      status: String(data.get('status') || 'online'),
      accent: String(data.get('accent') || ''),
      avatar: draftAvatar
    };
    if (!patch.displayName) { toast(t('failure'), 'error'); return; }
    try {
      const saved = await bridge.auth.updateProfile(account.username, patch);
      account.profile = saved.profile;
      setAccent(patch.accent, true);
      net.send('profile:update', { profile: patch });
      toast(t('success'), 'success');
      renderProfile(node, account);
    } catch (err) { toast(err.message || t('failure'), 'error'); }
  });
  $('[data-profile="password"]', node).addEventListener('click', () => changePassword(account));
  $('[data-profile="delete"]', node).addEventListener('click', async () => {
    if (!await confirmDialog(t('confirmDelete'))) return;
    openModal({
      title: t('deleteAccount'),
      content: '<div class="field"><label>' + esc(t('password')) + '</label><input class="delete-password" type="password"></div>',
      buttons: [
        { label: t('cancel'), kind: 'ghost' },
        { label: t('delete'), kind: 'danger', action: async (root) => {
          try {
            await bridge.auth.remove(account.username, root.querySelector('.delete-password').value);
            location.reload();
          } catch (err) { toast(err.message || t('failure'), 'error'); return false; }
        } }
      ]
    });
  });
}

function pickAvatar(account) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/png,image/jpeg,image/webp';
  input.addEventListener('change', () => {
    const file = input.files[0];
    if (!file) return;
    if (file.size > 12 * 1024 * 1024) { toast(t('fileTooLarge'), 'error'); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const size = 256;
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = size;
        const ctx = canvas.getContext('2d');
        const side = Math.min(img.width, img.height);
        ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
        draftAvatar = canvas.toDataURL('image/jpeg', 0.82);
        const holder = profileContainer?.querySelector('.avatar-picker');
        if (holder) holder.innerHTML = avatar({ displayName: account.profile?.displayName || account.username, avatar: draftAvatar }, 'profile-avatar') +
          '<button class="icon-btn" data-profile="avatar" title="' + esc(t('chooseImage')) + '">' + icon('image') + '</button>';
        holder?.querySelector('[data-profile="avatar"]')?.addEventListener('click', () => pickAvatar(account));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
  input.click();
}

function changePassword(account) {
  openModal({
    title: t('changePassword'),
    content:
      '<div class="field"><label>' + esc(t('oldPassword')) + '</label><input class="old-pass" type="password"></div>' +
      '<div class="field"><label>' + esc(t('newPassword')) + '</label><input class="new-pass" type="password" minlength="6"></div>',
    buttons: [
      { label: t('cancel'), kind: 'ghost' },
      { label: t('save'), kind: 'primary', action: async (root) => {
        try {
          await bridge.auth.changePassword(account.username, root.querySelector('.old-pass').value, root.querySelector('.new-pass').value);
          toast(t('success'), 'success');
        } catch (err) { toast(err.message || t('failure'), 'error'); return false; }
      } }
    ]
  });
}

export function showPeerProfile(peerId) {
  const peer = net.peers.get(peerId) || (net.members.size ? [...net.members.values()].flat().find((p) => p.id === peerId) : null);
  if (!peer) { toast(t('noUsers'), 'error'); return; }
  openModal({
    title: t('profile'),
    content: '<div class="profile-hero compact">' + avatar(peer, 'profile-avatar') +
      '<div class="profile-details"><h3 class="profile-name">' + esc(peer.displayName || peer.name) + '</h3>' +
      '<p class="profile-handle mono">@' + esc(peer.username || peer.id.slice(0, 8)) + '</p>' +
      '<span class="pill ' + statusClass(peer.status) + '">' + esc(t(peer.status || 'online')) + '</span></div></div>' +
      (peer.bio ? '<p class="profile-bio">' + esc(peer.bio) + '</p>' : '') +
      '<p class="field-hint">' + icon('network') + ' ' + esc(peer.network || t('network')) + '</p>',
    buttons: [
      { label: t('close'), kind: 'ghost' },
      { label: t('startPrivateChat'), kind: 'primary', action: () => { import('./chat.js').then((m) => m.chat.openDM(peerId)); } }
    ]
  });
}

export async function renderSettings(node) {
  settingsContainer = node;
  if (!node) return;
  const mode = await bridge.store.get('voiceMode', 'auto');
  const sensitivity = await bridge.store.get('micSensitivity', 0.55);
  const gate = await bridge.store.get('noiseGate', true);
  const echo = await bridge.store.get('echoCancel', true);
  const tray = isDesktop ? await bridge.store.get('minimizeToTray', true) : false;
  voice.setMode(mode);
  voice.setSensitivity(sensitivity);
  voice.setNoiseGate(gate);
  voice.setEchoCancel(echo);

  node.innerHTML =
    '<div class="view">' +
      '<div class="view-header"><div><h1 class="view-title">' + esc(t('settings')) + '</h1></div></div>' +
      '<div class="settings-section"><h2>' + icon('palette') + ' ' + esc(t('themes')) + '</h2>' + themeGrid(getTheme()) +
        '<div class="setting-row"><span><span class="setting-label">' + esc(t('accent') || 'Accent') + '</span></span>' +
        '<input type="color" class="accent-color" value="' + esc(getAccent() || '#3584e4') + '"></div>' +
      '</div>' +
      '<div class="settings-section"><h2>' + icon('mic') + ' ' + esc(t('micEnhance')) + '</h2>' +
        '<div class="setting-row"><span><span class="setting-label">' + esc(t('voiceMode')) + '</span><span class="setting-desc">' + esc(t('voiceHint')) + '</span></span>' +
        '<select class="select voice-mode"><option value="auto" ' + (mode === 'auto' ? 'selected' : '') + '>' + esc(t('auto')) + '</option>' +
        '<option value="webrtc" ' + (mode === 'webrtc' ? 'selected' : '') + '>' + esc(t('webrtc')) + '</option>' +
        '<option value="udp" ' + (mode === 'udp' ? 'selected' : '') + '>' + esc(t('udp')) + ' (LAN)</option></select></div>' +
        '<div class="setting-row"><span><span class="setting-label">' + esc(t('sensitivity')) + '</span></span>' +
        '<input type="range" class="slider mic-sensitivity" min="0" max="1" step="0.05" value="' + esc(sensitivity) + '"></div>' +
        '<div class="setting-row"><span><span class="setting-label">' + esc(t('noiseGate')) + '</span></span>' +
        '<span class="switch"><input type="checkbox" class="noise-gate" ' + (gate ? 'checked' : '') + '></span></div>' +
        '<div class="setting-row"><span><span class="setting-label">' + esc(t('echoCancel')) + '</span></span>' +
        '<span class="switch"><input type="checkbox" class="echo-cancel" ' + (echo ? 'checked' : '') + '></span></div>' +
      '</div>' +
      '<div class="settings-section"><h2>' + icon('globe') + ' ' + esc(t('language')) + '</h2>' +
        '<div class="setting-row"><span><span class="setting-label">' + esc(t('language')) + '</span></span>' +
        '<select class="select language-select"><option value="ar" ' + (getLanguage() === 'ar' ? 'selected' : '') + '>العربية</option>' +
        '<option value="en" ' + (getLanguage() === 'en' ? 'selected' : '') + '>English</option></select></div>' +
      '</div>' +
      (isDesktop ? '<div class="settings-section"><h2>' + icon('monitor') + ' ' + esc(t('window') || 'Window') + '</h2>' +
        '<div class="setting-row"><span><span class="setting-label">' + esc(t('minimize') || 'Minimize') + ' → Tray</span></span>' +
        '<span class="switch"><input type="checkbox" class="minimize-tray" ' + (tray ? 'checked' : '') + '></span></div></div>' : '') +
      '<div class="settings-section"><h2>' + icon('download') + ' ' + esc(t('backupSettings')) + '</h2>' +
        '<p class="muted">' + esc(t('backupHint')) + '</p>' +
        '<div class="backup-actions">' +
          '<button class="btn secondary" data-backup="export">' + icon('download') + ' ' + esc(t('exportSettings')) + '</button>' +
          '<button class="btn secondary" data-backup="import">' + icon('upload') + ' ' + esc(t('importSettings')) + '</button>' +
        '</div></div>' +
      '<div class="settings-section"><h2>' + icon('shield') + ' ' + esc(t('security')) + '</h2>' +
        '<p class="muted">' + esc(t('aboutText')) + '</p>' +
        '<p class="field-hint">' + icon('lock') + ' PBKDF2-SHA256 · WebRTC DTLS-SRTP · ' + esc(t('version')) + ' 1.0.0</p>' +
      '</div>' +
    '</div>';

  node.querySelectorAll('[data-theme]').forEach((button) => {
    button.addEventListener('click', () => {
      applyTheme(button.dataset.theme, true);
      node.querySelectorAll('.theme-card').forEach((card) => card.classList.toggle('active', card === button));
    });
  });
  $('.accent-color', node).addEventListener('input', (e) => setAccent(e.target.value, true));
  $('.voice-mode', node).addEventListener('change', (e) => {
    bridge.store.set('voiceMode', e.target.value).catch(() => {});
    voice.setMode(e.target.value);
  });
  $('.mic-sensitivity', node).addEventListener('input', (e) => {
    const value = Number(e.target.value);
    voice.setSensitivity(value);
    bridge.store.set('micSensitivity', value).catch(() => {});
  });
  $('.noise-gate', node).addEventListener('change', (e) => {
    voice.setNoiseGate(e.target.checked);
    bridge.store.set('noiseGate', e.target.checked).catch(() => {});
  });
  $('.echo-cancel', node).addEventListener('change', (e) => {
    voice.setEchoCancel(e.target.checked);
    bridge.store.set('echoCancel', e.target.checked).catch(() => {});
  });
  $('.language-select', node).addEventListener('change', (e) => {
    // setLanguage() notifies the app shell, which re-renders every view.
    setLanguage(e.target.value);
  });
  $('.minimize-tray', node)?.addEventListener('change', (e) => {
    bridge.store.set('minimizeToTray', e.target.checked).catch(() => {});
  });
  $('[data-backup="export"]', node)?.addEventListener('click', () => exportSettings());
  $('[data-backup="import"]', node)?.addEventListener('click', importSettings);
}
