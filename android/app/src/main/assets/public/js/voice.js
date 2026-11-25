import { net } from './net.js';
import { bridge, isDesktop } from './bridge.js';
import { micEV, PCMPlayer } from './micEV.js';
import { t } from './i18n.js';
import { icon } from './icons.js';
import { esc, $, toast } from './ui.js';

class VoiceManager {
  constructor() {
    this.roomId = null;
    this.active = false;
    this.muted = false;
    this.mode = 'auto';
    this.current = 'webrtc';
    this.localStream = null;
    this.peers = new Map();
    this.player = new PCMPlayer();
    this.levelNode = null;
    this.barNode = null;
    this.fallbackTimer = null;
    this.udpReady = false;
    this.sensitivity = 0.55;
    this.callKind = 'voice';
    this.callId = '';
    this.contextType = 'room';
    this.incoming = null;
    this.cameraEnabled = true;
    this.callOverlay = null;
    this.udpUnsubscribe = null;
    this.gate = true;
    this.echoCancel = true;

    net.on('signal', (msg) => this._onSignal(msg));
    net.on('peer:left-room', (msg) => {
      if (msg.roomId === this.roomId) this._removePeer(msg.id);
    });
    net.on('members', ({ roomId, members }) => {
      if (roomId !== this.roomId || !this.active || this.current !== 'webrtc') return;
      const ids = new Set(members.map((m) => m.id));
      for (const id of [...this.peers.keys()]) if (!ids.has(id)) this._removePeer(id);
      for (const member of members) if (member.id !== net.me?.id) this._ensurePeer(member.id);
    });
    net.on('room:left', (msg) => { if (msg.roomId === this.roomId) this.leave(); });
    net.on('disconnected', () => { if (this.active) this.leave(); });
  }

  attachBar(node) {
    this.barNode = node;
    this.levelNode = node ? $('.level-fill', node) : null;
    this.render();
  }

  setSensitivity(value) {
    this.sensitivity = Math.max(0, Math.min(1, Number(value) || 0));
    micEV.setSensitivity(this.sensitivity);
  }

  setNoiseGate(enabled) {
    this.gate = !!enabled;
    micEV.setGate(this.gate);
  }

  setEchoCancel(enabled) {
    this.echoCancel = !!enabled;
  }

  setMode(mode) {
    const next = ['auto', 'webrtc', 'udp'].includes(mode) ? mode : 'auto';
    // renderSettings() applies the saved mode on every visit; only restart a
    // live call when the user actually changes the mode.
    if (next === this.mode) return;
    this.mode = next;
    if (this.active) {
      const room = this.roomId;
      const options = {
        video: this.callKind === 'video',
        type: this.contextType,
        callId: this.callId,
        silent: true
      };
      this.leave();
      this.join(room, options);
    }
  }

  _signalRoomId() {
    return this.contextType === 'dm' ? 'dm:' + this.roomId : this.roomId;
  }

  render() {
    if (!this.barNode) return;
    const label = this.active
      ? (this.current === 'udp' ? t('udp') : t('webrtc'))
      : t('voice');
    this.barNode.innerHTML =
      '<div class="voice-pill">' + icon('headphones') +
        '<span>' + esc(label) + '</span>' +
        (this.active ? '<span class="level-meter"><span class="level-fill" style="width:0%"></span></span>' : '') +
      '</div>' +
      '<div class="voice-controls">' +
        '<button class="icon-btn ' + (this.muted ? 'active' : '') + '" data-voice="mute" title="' + esc(this.muted ? t('unmuted') : t('micOff')) + '">' +
          icon(this.muted ? 'mic-off' : 'mic') + '</button>' +
        '<button class="btn ' + (this.active ? 'danger' : 'primary') + '" data-voice="toggle">' +
          icon(this.active ? 'phone-off' : 'phone') + ' ' + esc(this.active ? t('leaveVoice') : t('joinVoice')) + '</button>' +
      '</div>';
    this.levelNode = $('.level-fill', this.barNode);
  }

  async join(roomId, options) {
    if (!roomId || this.active) return;
    options = options || {};
    this.contextType = options.type === 'dm' ? 'dm' : 'room';
    this.callKind = options.video ? 'video' : 'voice';
    this.callId = options.callId || ('c-' + (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '').slice(0, 16) : String(Date.now())));
    this.cameraEnabled = !!options.video;
    if (!navigator.mediaDevices?.getUserMedia) { toast(t('permissions'), 'error'); return; }
    this.roomId = roomId;
    this.active = true;
    this.current = this.mode === 'udp' || (this.mode === 'auto' && !isDesktop) ? 'udp' : 'webrtc';
    if (this.current === 'udp' && !isDesktop) {
      toast(t('udp') + ' — WebRTC', 'info');
      this.current = 'webrtc';
    }
    try {
      this.localStream = await micEV.start({
        sensitivity: this.sensitivity,
        gate: this.gate,
        echoCancel: this.echoCancel,
        video: this.callKind === 'video',
        onLevel: (level, voice) => this._onLevel(level, voice),
        onPCM: (frame) => this._onPCM(frame)
      });
    } catch (_) {
      toast(t('permissions'), 'error');
      this.active = false;
      this.roomId = null;
      this.render();
      return;
    }
    this.render();
    this._showCallOverlay();
    // An accepted incoming call already answered the caller — don't ring them twice.
    if (!options.silent) {
      const targets = this.contextType === 'dm'
        ? [roomId]
        : (net.members.get(roomId) || []).map((member) => member.id).filter((id) => id !== net.me?.id);
      for (const target of targets) {
        net.send('signal', {
          to: target,
          roomId: this.contextType === 'dm' ? 'dm:' + roomId : roomId,
          data: { type: 'call', kind: this.callKind, callId: this.callId }
        });
      }
    }
    if (this.current === 'webrtc') {
      await this._startWebRTC();
      if (this.mode === 'auto' && isDesktop) {
        this.fallbackTimer = setTimeout(() => {
          if (this.active && this.current === 'webrtc' && this._connectedPeers() === 0) this._switchToUdp();
        }, 9000);
      }
    } else {
      await this._startUdp();
    }
  }

  leave() {
    if (!this.active) return;
    if (this.callId) {
      const targets = this.contextType === 'dm'
        ? [this.roomId]
        : (net.members.get(this.roomId) || []).map((member) => member.id).filter((id) => id !== net.me?.id);
      for (const target of targets) {
        net.send('signal', {
          to: target,
          roomId: this.contextType === 'dm' ? 'dm:' + this.roomId : this.roomId,
          data: { type: 'call-end', callId: this.callId }
        });
      }
    }
    this.active = false;
    if (this.fallbackTimer) { clearTimeout(this.fallbackTimer); this.fallbackTimer = null; }
    for (const id of [...this.peers.keys()]) this._removePeer(id);
    micEV.stop();
    this.player.stop();
    if (this.udpUnsubscribe) { this.udpUnsubscribe(); this.udpUnsubscribe = null; }
    if (isDesktop) bridge.voice.udpStop().catch(() => {});
    this.localStream = null;
    this.udpReady = false;
    this.roomId = null;
    this.callId = '';
    this.incoming = null;
    this._hideCallOverlay();
    this.muted = false;
    this.render();
  }

  acceptIncoming() {
    const incoming = this.incoming;
    if (!incoming) return;
    this.incoming = null;
    net.send('signal', {
      to: incoming.from,
      roomId: incoming.roomId,
      data: { type: 'call-answer', callId: incoming.callId }
    });
    this.join(incoming.contextType === 'dm' ? incoming.peerId : incoming.roomId, {
      video: incoming.kind === 'video',
      type: incoming.contextType,
      callId: incoming.callId,
      silent: true
    });
  }

  declineIncoming() {
    const incoming = this.incoming;
    if (!incoming) return;
    net.send('signal', {
      to: incoming.from,
      roomId: incoming.roomId,
      data: { type: 'call-end', callId: incoming.callId }
    });
    this.incoming = null;
    this._hideCallOverlay();
  }

  toggleCamera() {
    if (!this.active || this.callKind !== 'video' || !this.localStream) return;
    this.cameraEnabled = !this.cameraEnabled;
    for (const track of this.localStream.getVideoTracks()) track.enabled = this.cameraEnabled;
    this._showCallOverlay();
  }

  _showCallOverlay() {
    if (!this.active && !this.incoming) return;
    let overlay = document.querySelector('.call-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'call-overlay';
      document.body.appendChild(overlay);
    }
    this.callOverlay = overlay;
    const incoming = this.incoming;
    const title = incoming
      ? t('incomingCall')
      : (this.callKind === 'video' ? t('videoCall') : t('audioCall'));
    const peerName = incoming
      ? (net.peers.get(incoming.from)?.displayName || net.peers.get(incoming.from)?.name || t('users'))
      : (this.contextType === 'dm'
        ? (net.peers.get(this.roomId)?.displayName || net.peers.get(this.roomId)?.name || t('directMessages'))
        : (net.rooms.get(this.roomId)?.name || t('rooms')));
    overlay.innerHTML =
      '<div class="call-card">' +
        '<div class="call-peer">' +
          '<span class="call-status">' + esc(title) + '</span>' +
          '<strong>' + esc(peerName) + '</strong>' +
        '</div>' +
        (this.callKind === 'video' && this.active
          ? '<video class="call-local-video" autoplay muted playsinline></video>' : '') +
        '<div class="call-grid" data-call-videos></div>' +
        '<div class="call-actions">' +
          (incoming
            ? '<button class="call-action decline" data-call-action="decline">' + icon('phone-off') + '<span>' + esc(t('declineCall')) + '</span></button>' +
              '<button class="call-action accept" data-call-action="accept">' + icon(incoming.kind === 'video' ? 'video' : 'phone') + '<span>' + esc(t('acceptCall')) + '</span></button>'
            : '<button class="call-action ' + (this.muted ? 'active' : '') + '" data-call-action="mute">' + icon(this.muted ? 'mic-off' : 'mic') + '<span>' + esc(this.muted ? t('unmuted') : t('micOff')) + '</span></button>' +
              (this.callKind === 'video' ? '<button class="call-action ' + (!this.cameraEnabled ? 'active' : '') + '" data-call-action="camera">' + icon('video') + '<span>' + esc(this.cameraEnabled ? t('cameraOff') : t('cameraOn')) + '</span></button>' : '') +
              '<button class="call-action decline" data-call-action="leave">' + icon('phone-off') + '<span>' + esc(t('endCall')) + '</span></button>') +
        '</div>' +
      '</div>';
    overlay.querySelector('[data-call-action="leave"]')?.addEventListener('click', () => this.leave());
    overlay.querySelector('[data-call-action="mute"]')?.addEventListener('click', () => this.toggleMute());
    overlay.querySelector('[data-call-action="camera"]')?.addEventListener('click', () => this.toggleCamera());
    overlay.querySelector('[data-call-action="accept"]')?.addEventListener('click', () => this.acceptIncoming());
    overlay.querySelector('[data-call-action="decline"]')?.addEventListener('click', () => this.declineIncoming());
    const localVideo = $('.call-local-video', overlay);
    if (localVideo && this.localStream) localVideo.srcObject = this.localStream;
  }

  _hideCallOverlay() {
    if (this.callOverlay) this.callOverlay.remove();
    this.callOverlay = null;
  }

  toggleMute() {
    if (!this.active) return;
    this.muted = !this.muted;
    for (const { pc } of this.peers.values()) {
      for (const sender of pc.getSenders()) if (sender.track) sender.track.enabled = !this.muted;
    }
    if (this.localStream) for (const track of this.localStream.getTracks()) track.enabled = !this.muted;
    this.render();
    if (this.active || this.incoming) this._showCallOverlay();
  }

  _onLevel(level, voice) {
    if (this.levelNode) this.levelNode.style.width = Math.round(level * 100) + '%';
    if (this.barNode) this.barNode.classList.toggle('speaking', !!voice && !this.muted);
  }

  _onPCM(frame) {
    if (!this.active || this.muted || this.current !== 'udp' || !this.udpReady) return;
    bridge.voice.udpSend(frame).catch(() => {});
  }

  async _startUdp() {
    const host = net.udp.host || (net.host || '127.0.0.1');
    const ok = await bridge.voice.udpStart(host, this.roomId).catch(() => false);
    if (!ok) { toast(t('failure'), 'error'); this.leave(); return; }
    this.udpReady = true;
    this.current = 'udp';
    await this.player.start().catch(() => {});
    if (this.udpUnsubscribe) this.udpUnsubscribe();
    this.udpUnsubscribe = bridge.voice.onUdpFrame((frame) => {
      if (this.active && this.current === 'udp') this.player.feed(new Int16Array(frame.buffer, frame.byteOffset, frame.byteLength / 2));
    });
    this.render();
  }

  _switchToUdp() {
    if (!isDesktop) return;
    for (const id of [...this.peers.keys()]) this._removePeer(id);
    this.current = 'udp';
    this._startUdp();
    toast(t('udp') + ' — ' + t('voiceMode'), 'info');
  }

  _connectedPeers() {
    return [...this.peers.values()].filter((p) => p.pc.connectionState === 'connected').length;
  }

  async _startWebRTC() {
    const members = this.contextType === 'dm'
      ? [{ id: this.roomId }]
      : (net.members.get(this.roomId) || []);
    for (const member of members) if (member.id !== net.me?.id) this._ensurePeer(member.id, true);
  }

  _newPC(peerId) {
    const pc = new RTCPeerConnection({ iceServers: [], bundlePolicy: 'max-bundle' });
    const entry = { pc, stream: new MediaStream(), audio: null, queue: [], makingOffer: false };
    this.peers.set(peerId, entry);
    if (this.localStream) for (const track of this.localStream.getTracks()) pc.addTrack(track, this.localStream);

    pc.onicecandidate = (event) => {
      if (!event.candidate) return;
      net.send('signal', {
        to: peerId,
        roomId: this._signalRoomId(),
        data: { type: 'ice', candidate: event.candidate.toJSON() }
      });
    };
    pc.ontrack = (event) => {
      entry.stream.addTrack(event.track);
      if (event.track.kind === 'video') {
        const overlay = document.querySelector('.call-overlay');
        const grid = overlay ? $('.call-grid', overlay) : null;
        if (grid) {
          let video = grid.querySelector('[data-peer-video="' + peerId + '"]');
          if (!video) {
            video = document.createElement('video');
            video.dataset.peerVideo = peerId;
            video.autoplay = true;
            video.playsInline = true;
            grid.appendChild(video);
          }
          video.srcObject = entry.stream;
        }
      }
      if (!entry.audio) {
        const audio = document.createElement('audio');
        audio.autoplay = true;
        audio.playsInline = true;
        audio.srcObject = entry.stream;
        audio.style.display = 'none';
        document.body.appendChild(audio);
        entry.audio = audio;
      }
      entry.stream.getAudioTracks().forEach((track) => { track.enabled = true; });
      audioAutoplay(entry.audio);
    };
    pc.onconnectionstatechange = () => {
      if (['failed', 'closed', 'disconnected'].includes(pc.connectionState)) {
        if (pc.connectionState === 'failed' && this.mode !== 'udp' && isDesktop) this._switchToUdp();
      }
    };
    pc.onnegotiationneeded = async () => {
      if (!this._isOfferer(peerId) || entry.makingOffer) return;
      entry.makingOffer = true;
      try {
        await pc.setLocalDescription();
        net.send('signal', { to: peerId, roomId: this._signalRoomId(), data: { type: 'sdp', sdp: pc.localDescription.toJSON() } });
      } catch (_) { /* ignore */ }
      finally { entry.makingOffer = false; }
    };
    return entry;
  }

  _isOfferer(peerId) {
    return String(net.me?.id || '').localeCompare(String(peerId)) < 0;
  }

  _ensurePeer(peerId, initial) {
    if (!this.active || this.current !== 'webrtc' || peerId === net.me?.id) return;
    if (!this.peers.has(peerId)) this._newPC(peerId);
    if (initial && this._isOfferer(peerId)) {
      const entry = this.peers.get(peerId);
      setTimeout(async () => {
        try {
          const offer = await entry.pc.createOffer();
          await entry.pc.setLocalDescription(offer);
          net.send('signal', { to: peerId, roomId: this._signalRoomId(), data: { type: 'sdp', sdp: entry.pc.localDescription.toJSON() } });
        } catch (_) { /* ignore */ }
      }, 120);
    }
  }

  async _onSignal(msg) {
    if (msg.data?.type === 'call') {
      if (this.active || this.incoming) {
        // Busy: reject the second call so the other peer does not ring forever.
        net.send('signal', {
          to: msg.from,
          roomId: msg.roomId,
          data: { type: 'call-end', callId: msg.data.callId }
        });
        return;
      }
      const dm = String(msg.roomId || '').startsWith('dm:');
      this.incoming = {
        from: msg.from,
        roomId: msg.roomId,
        peerId: dm ? msg.from : null,
        contextType: dm ? 'dm' : 'room',
        kind: msg.data.kind,
        callId: msg.data.callId
      };
      this.callKind = msg.data.kind;
      this._showCallOverlay();
      return;
    }
    if (msg.data?.type === 'call-end') {
      if (this.incoming?.callId === msg.data.callId) {
        this.incoming = null;
        this._hideCallOverlay();
      } else if (this.active && this.callId === msg.data.callId) {
        this.callId = '';
        this.leave();
      }
      return;
    }
    if (!this.active || this.current !== 'webrtc') return;
    const expectedRoomId = this._signalRoomId();
    if (msg.roomId !== expectedRoomId) return;
    let entry = this.peers.get(msg.from);
    if (!entry) entry = this._newPC(msg.from);
    const pc = entry.pc;
    try {
      if (msg.data.type === 'sdp') {
        const description = msg.data.sdp;
        const offerCollision = description.type === 'offer' && (entry.makingOffer || pc.signalingState !== 'stable');
        if (offerCollision) {
          if (!this._isOfferer(msg.from)) await pc.setRemoteDescription(description);
          else return;
        } else {
          await pc.setRemoteDescription(description);
        }
        const queue = entry.queue.splice(0);
        for (const candidate of queue) { try { await pc.addIceCandidate(candidate); } catch (_) { /* ignore */ } }
        if (description.type === 'offer') {
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          net.send('signal', { to: msg.from, roomId: this._signalRoomId(), data: { type: 'sdp', sdp: pc.localDescription.toJSON() } });
        }
      } else if (msg.data.type === 'ice') {
        const candidate = msg.data.candidate;
        if (!pc.remoteDescription) entry.queue.push(candidate);
        else await pc.addIceCandidate(candidate);
      }
    } catch (_) { /* ignore malformed or late signals */ }
  }

  _removePeer(peerId) {
    const entry = this.peers.get(peerId);
    if (!entry) return;
    try { entry.pc.close(); } catch (_) { /* ignore */ }
    if (entry.audio) { entry.audio.srcObject = null; entry.audio.remove(); }
    this.peers.delete(peerId);
  }
}

function audioAutoplay(audio) {
  audio.play().catch(() => {
    const resume = () => { audio.play().catch(() => {}); document.removeEventListener('pointerdown', resume); };
    document.addEventListener('pointerdown', resume);
  });
}

export const voice = new VoiceManager();
