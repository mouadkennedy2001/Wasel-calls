import { net } from './net.js';
import { t } from './i18n.js';
import { icon } from './icons.js';
import { esc, $, avatar, formatTime, toast, debounce, emptyState, confirmDialog } from './ui.js';
import { getFileInfo } from './files.js';
import { voice } from './voice.js';

class ChatManager {
  constructor() {
    this.container = null;
    this.context = null;
    this.messages = new Map();
    this.unread = new Map();
    this.onUnread = null;
    this.badges = {};
    this.typingUsers = new Map();
    this.typingTimer = null;
    this.drafts = new Map();

    net.on('chat', (message) => this._incoming(message));
    net.on('dm', (message) => this._incoming(message, 'dm'));
    net.on('dm:history', ({ to, messages }) => {
      const key = 'dm:' + to;
      this.messages.set(key, messages || []);
      if (this.context?.key === key) this.render();
    });
    net.on('typing', ({ roomId, id, active }) => {
      this.typingUsers.set(id, active ? Date.now() : 0);
      if (this.context?.id === roomId) this._renderTyping();
    });
    net.on('peer:profile', () => { if (this.context) this.render(); });
    net.on('rooms', () => { if (this.context?.type === 'room' && this.container) this.render(); });
    net.on('room:left', (msg) => {
      if (this.context?.key === 'room:' + msg.roomId) this.openWelcome();
    });
    // Keep the mounted container across reconnects — dropping it made the chat
    // view permanently blank until the app was restarted.
    net.on('disconnected', () => { this.context = null; this.render(); });

    this._typingSend = debounce((active) => {
      if (this.context?.type === 'room') net.send('typing', { roomId: this.context.id, active });
    }, 350);
  }

  mount(container) {
    this.container = container;
    this.render();
  }

  openRoom(roomId) {
    this.context = { type: 'room', id: roomId, key: 'room:' + roomId };
    this.unread.set(this.context.key, 0);
    if (!this.messages.has(this.context.key)) this.messages.set(this.context.key, []);
    this._emitUnread();
    this.render();
  }

  openDM(peerId) {
    this.context = { type: 'dm', id: peerId, key: 'dm:' + peerId };
    this.unread.set(this.context.key, 0);
    if (!this.messages.has(this.context.key)) {
      this.messages.set(this.context.key, []);
      net.send('dm:history', { to: peerId });
    }
    this._emitUnread();
    this.render();
  }

  openWelcome() {
    this.context = null;
    this.render();
  }

  _incoming(message, kind) {
    const isDM = kind === 'dm' || !!message.to;
    const key = isDM
      ? 'dm:' + (message.from === net.me?.id ? message.to : message.from)
      : 'room:' + message.roomId;
    const list = this.messages.get(key) || [];
    if (!list.some((m) => m.id === message.id)) list.push(message);
    this.messages.set(key, list);
    if (!this.context || this.context.key !== key) {
      this.unread.set(key, (this.unread.get(key) || 0) + 1);
      this._emitUnread();
    }
    if (this.context?.key === key) {
      const scroller = $('.chat-messages', this.container);
      const nearBottom = scroller ? scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 140 : true;
      this.render();
      if (nearBottom) this._scrollBottom();
    }
  }

  _emitUnread() {
    if (this.onUnread) this.onUnread(Object.fromEntries(this.unread));
  }

  _fileBubble(fileId) {
    const file = getFileInfo(fileId);
    if (!file) return '';
    return '<div class="msg-file">' + icon('file') +
      '<div><span class="file-name">' + esc(file.name) + '</span><small>' + esc(file.size ? Math.round(file.size / 1024) + ' KB' : '') + '</small></div>' +
      '<button class="icon-btn" data-download="' + esc(file.id) + '" data-token="' + esc(file.token) + '" title="' + esc(t('download')) + '">' + icon('download') + '</button></div>';
  }

  _messageHTML(message) {
    const mine = message.from === net.me?.id;
    const author = message.author || '?';
    return '<div class="msg ' + (mine ? 'mine' : '') + '" data-message-id="' + esc(message.id) + '">' +
      avatar({ displayName: author, avatar: message.avatar }, 'msg-avatar') +
      '<div class="msg-body">' +
        (mine ? '' : '<span class="msg-author">' + esc(author) + '</span>') +
        (message.text ? '<div class="msg-text">' + esc(message.text) + '</div>' : '') +
        (message.fileId ? this._fileBubble(message.fileId) : '') +
        '<span class="msg-time">' + esc(formatTime(message.ts)) + (mine ? ' ' + icon('check-double', 'icon-sm') : '') + '</span>' +
      '</div></div>';
  }

  _renderTyping() {
    const node = $('.typing-indicator', this.container);
    if (!node) return;
    if (this.typingTimer) { clearTimeout(this.typingTimer); this.typingTimer = null; }
    const now = Date.now();
    const active = [...this.typingUsers.entries()].filter(([id, ts]) => now - ts < 4000 && id !== net.me?.id);
    node.textContent = active.length ? t('typing') : '';
    if (active.length) {
      const remaining = Math.min(...active.map(([, ts]) => 4000 - (now - ts)));
      this.typingTimer = setTimeout(() => this._renderTyping(), Math.max(100, remaining));
    }
  }

  _scrollBottom() {
    const scroller = $('.chat-messages', this.container);
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  }

  render() {
    if (!this.container) return;
    if (!this.context) {
      this.container.innerHTML = '<div class="view">' + emptyState('chat', t('selectRoom')) + '</div>';
      return;
    }
    const isRoom = this.context.type === 'room';
    const room = isRoom ? net.rooms.get(this.context.id) : null;
    const peer = !isRoom ? (net.peers.get(this.context.id) || { displayName: t('users'), name: t('users') }) : null;
    const title = isRoom ? (room?.name || t('rooms')) : (peer.displayName || peer.name || t('directMessages'));
    const messages = this.messages.get(this.context.key) || [];
    const draftKey = this.context.key;
    const draft = this.drafts.get(draftKey) || '';
    this.container.innerHTML =
      '<div class="view chat-layout">' +
        '<div class="chat-header">' +
          '<div class="chat-header-info">' + avatar(isRoom ? { displayName: title } : peer) +
            '<div><h2 class="view-title">' + esc(title) + '</h2>' +
            '<p class="view-subtitle">' + esc(isRoom ? (room?.description || t('members') + ': ' + (room?.members || 0)) : t('directMessages')) + '</p></div>' +
          '</div>' +
          '<div class="view-actions">' +
            (isRoom ? '<button class="icon-btn" data-chat-action="members" title="' + esc(t('members')) + '">' + icon('users') + '</button>' : '') +
            '<button class="icon-btn chat-call-btn" data-chat-action="audio-call" title="' + esc(t('audioCall')) + '">' + icon('phone') + '</button>' +
            '<button class="icon-btn chat-call-btn" data-chat-action="video-call" title="' + esc(t('videoCall')) + '">' + icon('video') + '</button>' +
            (isRoom
              ? '<button class="icon-btn" data-chat-action="leave-room" title="' + esc(t('leaveRoom')) + '">' + icon('logout') + '</button>'
              : '<button class="icon-btn" data-chat-action="profile" title="' + esc(t('viewProfile')) + '">' + icon('user') + '</button>') +
          '</div>' +
        '</div>' +
        '<div class="chat-messages scroll">' +
          (messages.length ? messages.map((m) => this._messageHTML(m)).join('') : emptyState('chat', t('noMessages'))) +
        '</div>' +
        '<div class="typing-indicator"></div>' +
        '<form class="composer">' +
          '<button type="button" class="icon-btn" data-chat-action="attach" title="' + esc(t('attachFile')) + '">' + icon('plus') + '</button>' +
          '<input class="composer-input" maxlength="4000" placeholder="' + esc(t('typeMessage')) + '" value="' + esc(draft) + '" autocomplete="off">' +
          '<button type="submit" class="icon-btn active" title="' + esc(t('send')) + '">' + icon('send') + '</button>' +
        '</form>' +
      '</div>';
    this._scrollBottom();
    this._renderTyping();

    const form = $('.composer', this.container);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = $('.composer-input', form);
      const text = input.value.trim();
      if (!text) return;
      const payload = isRoom ? { roomId: this.context.id, text } : { to: this.context.id, text };
      net.send(isRoom ? 'chat' : 'dm', payload);
      input.value = '';
      this.drafts.set(draftKey, '');
      this._typingSend(false);
    });
    $('.composer-input', form).addEventListener('input', (e) => {
      this.drafts.set(draftKey, e.target.value);
      if (isRoom) this._typingSend(true);
    });
    $('.composer-input', form).addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) form.requestSubmit();
    });
  }

  handleAction(action) {
    if (action === 'attach') {
      import('./files.js').then((m) => m.pickAndShare(this.context?.type === 'room' ? this.context.id : null, this.context?.type === 'dm' ? this.context.id : null));
    } else if (action === 'members' && this.context?.type === 'room') {
      import('./rooms.js').then((m) => m.showMembers(this.context.id));
    } else if (action === 'profile' && this.context?.type === 'dm') {
      import('./profile.js').then((m) => m.showPeerProfile(this.context.id));
    } else if (action === 'leave-room' && this.context?.type === 'room') {
      confirmDialog(t('leaveRoom')).then((ok) => {
        if (!ok) return;
        net.send('room:leave', { roomId: this.context.id });
        this.openWelcome();
      });
    } else if (action === 'audio-call' || action === 'video-call') {
      if (!this.context) { toast(t('selectRoom'), 'info'); return; }
      const video = action === 'video-call';
      if (this.context.type === 'room') voice.join(this.context.id, { video, type: 'room' });
      else voice.join(this.context.id, { video, type: 'dm' });
    }
  }
}

export const chat = new ChatManager();
