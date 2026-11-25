import { net } from './net.js';
import { t } from './i18n.js';
import { icon } from './icons.js';
import { esc, $, toast, emptyState, formatBytes, formatTime, fileIcon } from './ui.js';
import { httpBase } from './url.js';

const registry = new Map();
let container = null;
const listeners = new Set();

function api() {
  return httpBase(net.host, net.port);
}

export function getFileInfo(id) { return registry.get(id) || null; }

export function registerFile(file) {
  if (!file || !file.id) return;
  registry.set(file.id, file);
  listeners.forEach((fn) => { try { fn(file); } catch (_) { /* ignore */ } });
}

export function onFile(callback) { listeners.add(callback); return () => listeners.delete(callback); }

export function initFiles() {
  net.on('file', (file) => {
    registerFile(file);
    toast(`${t('sharedBy')} ${file.name}`, 'info');
    if (container) renderFiles(container);
  });
}

export function upload(file, roomId, to) {
  return new Promise((resolve, reject) => {
    if (!net.token) {
      toast(t('disconnected'), 'error');
      reject(new Error(t('disconnected')));
      return;
    }
    if (file.size > (net.limits.maxFile || 200 * 1024 * 1024)) {
      toast(t('fileTooLarge'), 'error');
      reject(new Error(t('fileTooLarge')));
      return;
    }
    const xhr = new XMLHttpRequest();
    xhr.open('POST', api() + '/api/upload');
    xhr.setRequestHeader('x-wasel-token', net.token);
    // Header values must be ASCII; Arabic and other non-Latin names need encoding.
    xhr.setRequestHeader('x-wasel-name', encodeURIComponent(file.name || 'file'));
    xhr.setRequestHeader('x-wasel-size', String(file.size));
    xhr.setRequestHeader('x-wasel-mime', file.type || 'application/octet-stream');
    if (roomId) xhr.setRequestHeader('x-wasel-room', roomId);
    if (to) xhr.setRequestHeader('x-wasel-to', to);
    let lastReported = -10;
    xhr.upload.onprogress = (e) => {
      const pct = e.lengthComputable ? Math.round((e.loaded / e.total) * 100) : 0;
      // Avoid flooding the toast stack with one notification per chunk.
      if (pct >= 100 || pct - lastReported >= 10) {
        lastReported = pct;
        document.dispatchEvent(new CustomEvent('wasel:upload-progress', { detail: { name: file.name, pct } }));
      }
    };
    xhr.onload = () => {
      let body = null;
      try { body = JSON.parse(xhr.responseText); } catch (_) { /* ignore */ }
      if (xhr.status >= 200 && xhr.status < 300 && body?.ok) {
        registerFile(body);
        net.send('file:notify', { fileId: body.id, roomId: roomId || undefined, to: to || undefined });
        const message = { roomId, to, text: '', fileId: body.id };
        net.send(roomId ? 'chat' : 'dm', message);
        toast(t('uploaded') + ': ' + file.name, 'success');
        resolve(body);
      } else {
        toast(body?.error || t('failure'), 'error');
        reject(new Error(body?.error || t('failure')));
      }
    };
    xhr.onerror = () => { toast(t('failure'), 'error'); reject(new Error(t('failure'))); };
    xhr.send(file);
  });
}

export function pickAndShare(roomId, to) {
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  input.addEventListener('change', () => {
    [...input.files].forEach((file) => upload(file, roomId, to).catch(() => {}));
  });
  input.click();
}

export async function download(file) {
  const url = `${api()}/api/download?id=${encodeURIComponent(file.id)}&token=${encodeURIComponent(file.token)}`;
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error('404');
    const blob = await response.blob();
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = file.name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 5000);
  } catch (_) {
    toast(t('failure'), 'error');
  }
}

export function renderFiles(node) {
  container = node;
  if (!container) return;
  const files = [...registry.values()].sort((a, b) => (b.ts || 0) - (a.ts || 0));
  container.innerHTML =
    '<div class="view">' +
      '<div class="view-header"><div><h1 class="view-title">' + esc(t('files')) + '</h1>' +
      '<p class="view-subtitle">' + esc(t('storageNote')) + '</p></div>' +
      '<button class="btn primary" data-files="pick">' + icon('upload') + ' ' + esc(t('shareFile')) + '</button></div>' +
      '<div class="dropzone" data-files="drop">' + icon('upload', 'icon-lg') + '<p>' + esc(t('dropFiles')) + '</p></div>' +
      '<div class="file-list scroll">' +
        (files.length ? files.map((file) =>
          '<div class="file-row">' +
            '<span class="file-icon">' + icon(fileIcon(file.name)) + '</span>' +
            '<div class="file-info"><strong>' + esc(file.name) + '</strong>' +
            '<small>' + esc(formatBytes(file.size)) + ' · ' + esc(formatTime(file.ts)) + '</small></div>' +
            '<button class="btn secondary" data-download="' + esc(file.id) + '">' + icon('download') + ' ' + esc(t('download')) + '</button>' +
          '</div>'
        ).join('') : emptyState('folder', t('noFiles'))) +
      '</div></div>';

  const dropzone = $('[data-files="drop"]', container);
  dropzone.addEventListener('click', () => pickAndShare(null, null));
  dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('active'); });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('active'));
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('active');
    [...e.dataTransfer.files].forEach((file) => upload(file, null, null).catch(() => {}));
  });
  $('[data-files="pick"]', container).addEventListener('click', () => pickAndShare(null, null));
  container.querySelectorAll('[data-download]').forEach((button) => {
    button.addEventListener('click', () => {
      const file = registry.get(button.dataset.download);
      if (file) download(file);
    });
  });
}
