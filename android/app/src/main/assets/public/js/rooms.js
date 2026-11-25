import { net } from './net.js';
import { t } from './i18n.js';
import { icon } from './icons.js';
import { esc, $, toast, emptyState, avatar, statusClass, openModal, closeModal, promptDialog } from './ui.js';
import { chat } from './chat.js';

let container = null;
let filter = '';

export function initRooms() {
  net.on('rooms', () => { if (container && !document.querySelector('.chat-messages')) renderRooms(container); });
  net.on('room:joined', (msg) => {
    const members = net.members.get(msg.room.id) || msg.members || [];
    net.members.set(msg.room.id, members);
    chat.openRoom(msg.room.id);
    toast(t('enterRoom') + ': ' + msg.room.name, 'success');
  });
  net.on('peer:join-room', ({ roomId, peer }) => {
    const list = net.members.get(roomId) || [];
    if (!list.some((m) => m.id === peer.id)) list.push(peer);
    net.members.set(roomId, list);
  });
}

export function createRoomDialog() {
  openModal({
    title: t('createRoom'),
    content:
      '<div class="field"><label>' + esc(t('roomName')) + '</label><input class="room-name" maxlength="64" required></div>' +
      '<div class="field"><label>' + esc(t('roomDescription')) + '</label><textarea class="room-desc-input" maxlength="160" rows="2"></textarea></div>' +
      '<label class="setting-row"><span><span class="setting-label">' + esc(t('privateRoom')) + '</span></span><span class="switch"><input type="checkbox" class="room-private"></span></label>' +
      '<div class="field room-password-field hidden"><label>' + esc(t('roomPassword')) + '</label><input class="room-password" type="password" minlength="4" maxlength="64"></div>',
    buttons: [
      { label: t('cancel'), kind: 'ghost' },
      { label: t('create'), kind: 'primary', action: (root) => {
        const name = root.querySelector('.room-name').value.trim();
        const description = root.querySelector('.room-desc-input').value.trim();
        const locked = root.querySelector('.room-private').checked;
        const password = root.querySelector('.room-password').value;
        if (name.length < 2) { toast(t('failure'), 'error'); return false; }
        if (locked && password.length < 4) { toast(t('weakPassword'), 'error'); return false; }
        net.send('room:create', { name, description, locked, password });
      } }
    ]
  });
  const modal = document.querySelector('.modal');
  modal?.querySelector('.room-private')?.addEventListener('change', (e) => {
    modal.querySelector('.room-password-field')?.classList.toggle('hidden', !e.target.checked);
  });
  setTimeout(() => modal?.querySelector('.room-name')?.focus(), 60);
}

export function joinRoomDialog() {
  const rooms = [...net.rooms.values()];
  openModal({
    title: t('joinRoom'),
    content:
      (rooms.length ? '<div class="room-picker">' + rooms.map((room) =>
        '<button class="room-option" data-join="' + esc(room.id) + '">' + icon(room.locked ? 'lock' : 'room') +
        '<span><strong>' + esc(room.name) + '</strong><small>' + esc(room.members) + ' ' + esc(t('members')) + '</small></span></button>'
      ).join('') + '</div>' : emptyState('room', t('noRooms'))) +
      '<div class="field"><label>' + esc(t('roomName')) + ' / ID</label><input class="join-id" maxlength="48" placeholder="' + esc(t('roomName')) + '"></div>' +
      '<div class="field"><label>' + esc(t('roomPassword')) + '</label><input class="join-password" type="password" maxlength="64"></div>',
    buttons: [
      { label: t('cancel'), kind: 'ghost' },
      { label: t('join'), kind: 'primary', action: (root) => {
        const roomId = root.querySelector('.join-id').value.trim();
        const password = root.querySelector('.join-password').value;
        if (!roomId) { toast(t('failure'), 'error'); return false; }
        net.send('room:join', { roomId, password });
      } }
    ]
  });
  document.querySelectorAll('[data-join]').forEach((button) => {
    button.addEventListener('click', () => {
      const room = net.rooms.get(button.dataset.join);
      const root = document.querySelector('.modal');
      if (!room) return;
      if (!room.locked) {
        closeModal();
        net.send('room:join', { roomId: room.id });
      } else {
        root.querySelector('.join-id').value = room.id;
        root.querySelector('.join-password').focus();
      }
    });
  });
}

export function showMembers(roomId) {
  const members = net.members.get(roomId) || [];
  const room = net.rooms.get(roomId);
  openModal({
    title: t('members') + (room ? ': ' + room.name : ''),
    content: '<div class="members-list">' + (members.length ? members.map((member) =>
      '<button class="member-row" data-member="' + esc(member.id) + '">' + avatar(member) +
      '<span class="member-info"><span class="member-name">' + esc(member.displayName || member.name) + '</span>' +
      '<span class="member-status ' + statusClass(member.status) + '">' + esc(t(member.status || 'online')) + '</span></span>' +
      (member.id === room?.ownerId ? icon('star') : '') + '</button>'
    ).join('') : emptyState('users', t('noUsers'))) + '</div>',
    buttons: [{ label: t('close'), kind: 'secondary' }]
  });
  document.querySelectorAll('[data-member]').forEach((button) => {
    button.addEventListener('click', () => {
      const id = button.dataset.member;
      if (id !== net.me?.id) { closeModal(); chat.openDM(id); }
    });
  });
}

export function renderRooms(node) {
  container = node;
  if (!container) return;
  const scrollTop = $('.rooms-grid', container)?.scrollTop || 0;
  const rooms = [...net.rooms.values()].filter((room) =>
    !filter || room.name.toLowerCase().includes(filter.toLowerCase())
  );
  container.innerHTML =
    '<div class="view">' +
      '<div class="view-header"><div><h1 class="view-title">' + esc(t('rooms')) + '</h1>' +
      '<p class="view-subtitle">' + esc(net.rooms.size + ' ' + t('rooms') + ' · ' + net.peers.size + ' ' + t('online')) + '</p></div>' +
      '<div class="view-actions">' +
        '<button class="btn secondary" data-rooms="join">' + icon('link') + ' ' + esc(t('joinRoom')) + '</button>' +
        '<button class="btn primary" data-rooms="create">' + icon('plus') + ' ' + esc(t('createRoom')) + '</button>' +
      '</div></div>' +
      '<div class="field rooms-search"><input class="rooms-filter" placeholder="' + esc(t('searchRooms')) + '" value="' + esc(filter) + '"></div>' +
      '<div class="rooms-grid scroll">' +
        (rooms.length ? rooms.map((room) =>
          '<article class="room-card" data-room="' + esc(room.id) + '">' +
            '<div class="room-card-icon">' + icon(room.locked ? 'lock' : 'room', 'icon-lg') + '</div>' +
            '<div class="room-meta"><h3 class="room-name">' + esc(room.name) + '</h3>' +
            '<p class="room-desc">' + esc(room.description || t('roomDesc') || '') + '</p>' +
            '<div class="room-badges"><span class="room-badge">' + icon('users') + ' ' + esc(room.members) + ' / 12</span>' +
            (room.ownerId === net.me?.id ? '<span class="room-badge">' + icon('star') + ' ' + esc(t('roleOwner')) + '</span>' : '') + '</div></div>' +
            '<div class="room-card-actions"><button class="btn secondary" data-enter="' + esc(room.id) + '">' + esc(t('enterRoom')) + '</button></div>' +
          '</article>'
        ).join('') : emptyState('room', t('noRooms'))) +
      '</div></div>';

  const grid = $('.rooms-grid', container);
  if (grid) grid.scrollTop = scrollTop;
  $('[data-rooms="create"]', container).addEventListener('click', createRoomDialog);
  $('[data-rooms="join"]', container).addEventListener('click', joinRoomDialog);
  const filterInput = $('.rooms-filter', container);
  filterInput.addEventListener('input', () => {
    filter = filterInput.value;
    renderRooms(container);
    const next = $('.rooms-filter', container);
    next.focus();
    next.setSelectionRange(next.value.length, next.value.length);
  });
  container.querySelectorAll('[data-enter]').forEach((button) => {
    button.addEventListener('click', (e) => {
      e.stopPropagation();
      const room = net.rooms.get(button.dataset.enter);
      if (room?.locked) {
        promptDialog(t('roomPassword'), '', { type: 'password', title: t('roomLocked') }).then((password) => {
          if (password !== null) net.send('room:join', { roomId: room.id, password });
        });
      } else net.send('room:join', { roomId: room.id });
    });
  });
}
