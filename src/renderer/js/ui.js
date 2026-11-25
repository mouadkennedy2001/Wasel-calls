import { icon } from './icons.js';
import { t } from './i18n.js';

export function esc(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[ch]);
}

export function $(selector, root) { return (root || document).querySelector(selector); }
export function $$(selector, root) { return [...(root || document).querySelectorAll(selector)]; }

export function initials(name) {
  const parts = String(name || '?').trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => [...p][0] || '').join('').toUpperCase();
}

const AVATAR_COLORS = ['#3584e4', '#9141ac', '#26a269', '#e66100', '#c01c28', '#1c7a8c', '#986a44', '#5e5c64'];

export function colorFrom(value) {
  let hash = 0;
  for (const ch of String(value || '')) hash = (hash * 31 + ch.codePointAt(0)) | 0;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

export function avatar(profile, size) {
  const name = profile && (profile.displayName || profile.name) ? (profile.displayName || profile.name) : '?';
  const cls = 'user-avatar ' + (size || '');
  if (profile && profile.avatar) return `<img class="${cls}" src="${esc(profile.avatar)}" alt="${esc(name)}">`;
  return `<span class="${cls}" style="background:${colorFrom(name)}">${esc(initials(name))}</span>`;
}

export function statusClass(status) {
  return 'status-' + (['online', 'away', 'busy', 'offline'].includes(status) ? status : 'offline');
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let value = bytes;
  while (value >= 1024 && i < units.length - 1) { value /= 1024; i++; }
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function formatTime(ts) {
  try {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch (_) { return ''; }
}

export function fileIcon(filename) {
  const ext = String(filename || '').split('.').pop().toLowerCase();
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'].includes(ext)) return 'image';
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return 'folder';
  if (['mp3', 'wav', 'ogg', 'flac', 'm4a'].includes(ext)) return 'volume';
  if (['mp4', 'mkv', 'avi', 'webm'].includes(ext)) return 'monitor';
  return 'file';
}

export function debounce(fn, wait) {
  let timer = null;
  return function (...args) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), wait);
  };
}

export function toast(message, type) {
  const stack = document.getElementById('toast-stack');
  if (!stack) return;
  const node = document.createElement('div');
  node.className = 'toast ' + (type || 'info');
  const kind = type === 'error' ? 'info' : type === 'success' ? 'check' : 'info';
  node.innerHTML = icon(kind) + '<span>' + esc(message) + '</span>' + icon('close', 'toast-close icon-sm');
  node.title = t('close');
  node.addEventListener('click', () => { node.style.opacity = '0'; setTimeout(() => node.remove(), 200); });
  stack.appendChild(node);
  setTimeout(() => {
    node.style.opacity = '0';
    node.style.transform = 'translateY(6px)';
    setTimeout(() => node.remove(), 260);
  }, 3600);
}

let modalCleanup = null;

export function openModal(options) {
  closeModal();
  const root = document.getElementById('modal-root');
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  const buttons = options.buttons || [{ label: t('close'), kind: 'secondary' }];
  backdrop.innerHTML = '<div class="modal" role="dialog" aria-modal="true">' +
    '<div class="modal-header"><h2>' + esc(options.title || '') + '</h2>' +
    '<button class="icon-btn" data-modal-close aria-label="' + esc(t('close')) + '">' + icon('close') + '</button></div>' +
    '<div class="modal-body">' + (options.content || '') + '</div>' +
    '<div class="modal-footer">' + buttons.map((b, i) =>
      '<button class="btn ' + esc(b.kind || 'secondary') + '" data-modal-action="' + i + '">' + esc(b.label) + '</button>'
    ).join('') + '</div></div>';
  root.appendChild(backdrop);
  let finished = false;
  const finish = (value) => {
    if (finished) return;
    finished = true;
    closeModal();
    if (options.onClose) options.onClose(value);
  };
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop || e.target.closest('[data-modal-close]')) finish(null);
    const action = e.target.closest('[data-modal-action]');
    if (action) {
      const button = buttons[Number(action.dataset.modalAction)];
      if (!button || !button.action) { finish(true); return; }
      if (action.disabled) return;
      const settle = (result) => {
        if (result !== false) finish(result === undefined ? true : result);
      };
      try {
        const result = button.action(backdrop);
        if (result && typeof result.then === 'function') {
          action.disabled = true;
          result.then(settle, () => { action.disabled = false; });
        } else settle(result);
      } catch (_) {
        action.disabled = false;
      }
    }
  });
  const focus = backdrop.querySelector('input, textarea, button.primary');
  if (focus) focus.focus();
  modalCleanup = () => {
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); finish(null); }
    if (e.key === 'Enter' && !e.shiftKey && e.target.tagName !== 'TEXTAREA') {
      const primary = backdrop.querySelector('.btn.primary');
      if (primary) { e.preventDefault(); primary.click(); }
    }
  };
  document.addEventListener('keydown', onKey);
  return backdrop;
}

export function closeModal() {
  if (modalCleanup) { modalCleanup(); modalCleanup = null; }
}

export function confirmDialog(message, title) {
  return new Promise((resolve) => {
    openModal({
      title: title || t('confirm'),
      content: '<p class="muted">' + esc(message) + '</p>',
      buttons: [
        { label: t('cancel'), kind: 'ghost', action: () => resolve(false) },
        { label: t('confirm'), kind: 'danger', action: () => resolve(true) }
      ],
      onClose: (value) => { if (value === null) resolve(false); }
    });
  });
}

export function promptDialog(label, value, options) {
  return new Promise((resolve) => {
    options = options || {};
    openModal({
      title: options.title || label,
      content: '<div class="field"><label>' + esc(label) + '</label><input class="modal-input" type="' + (options.type || 'text') + '" value="' + esc(value || '') + '" placeholder="' + esc(options.placeholder || '') + '"></div>',
      buttons: [
        { label: t('cancel'), kind: 'ghost', action: () => resolve(null) },
        { label: options.confirm || t('confirm'), kind: 'primary', action: (root) => {
          const input = root.querySelector('.modal-input');
          const result = input ? input.value.trim() : '';
          if (!result) return false;
          resolve(result);
        } }
      ],
      onClose: (v) => { if (v === null) resolve(null); }
    });
  });
}

export function emptyState(iconName, text) {
  return '<div class="empty-state">' + icon(iconName, 'icon-lg') + '<p>' + esc(text) + '</p></div>';
}
