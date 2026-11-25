/**
 * micEV - microphone enhancement pipeline.
 * Uses browser WebRTC audio constraints (AEC / NS / AGC) plus a Web Audio DSP
 * chain: high-pass + low-pass + compressor + adaptive gate + output gain.
 * No cloud processing: everything runs locally on the device.
 */
export class MicEV {
  constructor() {
    this.ctx = null;
    this.stream = null;
    this.processed = null;
    this.nodes = [];
    this.analyser = null;
    this.captureNode = null;
    this.gateGain = null;
    this.monitorTimer = null;
    this.level = 0;
    this.voice = false;
    this.sensitivity = 0.55;
    this.gate = true;
    this.gainValue = 1.5;
    this.onLevel = null;
    this.onPCM = null;
    this._buffer = new Float32Array(320);
    this._bufferIndex = 0;
  }

  async start(options) {
    options = options || {};
    this.stop();
    this.sensitivity = typeof options.sensitivity === 'number' ? options.sensitivity : this.sensitivity;
    this.gate = options.gate !== false;
    this.gainValue = typeof options.gain === 'number' ? options.gain : 1.5;
    this.onLevel = options.onLevel || null;
    this.onPCM = options.onPCM || null;

    const constraints = {
      audio: {
        deviceId: options.deviceId ? { exact: options.deviceId } : undefined,
        echoCancellation: options.echoCancel !== false,
        noiseSuppression: options.noiseSuppress !== false,
        autoGainControl: options.autoGain !== false,
        channelCount: 1,
        sampleRate: 48000
      },
      video: options.video ? {
        facingMode: 'user',
        width: { ideal: 1280 },
        height: { ideal: 720 }
      } : false
    };
    this.stream = await navigator.mediaDevices.getUserMedia(constraints);
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AudioCtx({ latencyHint: 'interactive' });
    if (this.ctx.state === 'suspended') await this.ctx.resume();

    const source = this.ctx.createMediaStreamSource(this.stream);
    const highpass = this.ctx.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.value = 85;
    highpass.Q.value = 0.7;

    const lowpass = this.ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = 7600;
    lowpass.Q.value = 0.7;

    const presence = this.ctx.createBiquadFilter();
    presence.type = 'peaking';
    presence.frequency.value = 2800;
    presence.Q.value = 0.9;
    presence.gain.value = 2.5;

    const compressor = this.ctx.createDynamicsCompressor();
    compressor.threshold.value = -24;
    compressor.knee.value = 18;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.004;
    compressor.release.value = 0.18;

    const preGain = this.ctx.createGain();
    preGain.gain.value = this.gainValue;

    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.6;

    this.preGain = preGain;

    this.gateGain = this.ctx.createGain();
    this.gateGain.gain.value = this.gate ? 0.02 : 1;

    const destination = this.ctx.createMediaStreamDestination();

    source.connect(highpass);
    highpass.connect(lowpass);
    lowpass.connect(presence);
    presence.connect(compressor);
    compressor.connect(preGain);
    preGain.connect(this.analyser);
    this.analyser.connect(this.gateGain);
    this.gateGain.connect(destination);

    this.nodes = [source, highpass, lowpass, presence, compressor, preGain, this.analyser, this.gateGain, destination];
    this.processed = destination.stream;

    try {
      await this.ctx.audioWorklet.addModule('./js/worklets/pcm-capture.js');
      this.captureNode = new AudioWorkletNode(this.ctx, 'pcm-capture', { numberOfInputs: 1, numberOfOutputs: 0 });
      this.captureNode.port.onmessage = (event) => {
        const frame = event.data && event.data.frame;
        if (!frame || !this.onPCM) return;
        const pcm = new Int16Array(frame.length);
        for (let i = 0; i < frame.length; i++) {
          const sample = Math.max(-1, Math.min(1, frame[i]));
          pcm[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
        }
        this.onPCM(pcm);
      };
      this.gateGain.connect(this.captureNode);
      this.nodes.push(this.captureNode);
    } catch (_) {
      this.captureNode = null;
    }

    this._startMonitor();
    return this.processed;
  }

  _startMonitor() {
    const samples = new Float32Array(this.analyser.fftSize);
    let smoothed = 0;
    this.monitorTimer = setInterval(() => {
      if (!this.analyser) return;
      this.analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
      const rms = Math.sqrt(sum / samples.length);
      smoothed = smoothed * 0.75 + rms * 0.25;
      const threshold = 0.045 - this.sensitivity * 0.035;
      this.voice = smoothed > threshold;
      this.level = Math.min(1, smoothed * 9);
      if (this.gateGain) {
        const target = this.gate ? (this.voice ? 1 : 0.02) : 1;
        this.gateGain.gain.setTargetAtTime(target, this.ctx.currentTime, this.voice ? 0.01 : 0.12);
      }
      if (this.onLevel) this.onLevel(this.level, this.voice);
    }, 50);
  }

  setSensitivity(value) { this.sensitivity = Math.max(0, Math.min(1, Number(value) || 0)); }
  setGate(enabled) {
    this.gate = !!enabled;
    if (this.gateGain && !this.gate) this.gateGain.gain.setTargetAtTime(1, this.ctx.currentTime, 0.05);
  }
  setGain(value) {
    this.gainValue = Math.max(0.2, Math.min(3, Number(value) || 1));
    if (this.preGain && this.preGain.gain) this.preGain.gain.setTargetAtTime(this.gainValue, this.ctx.currentTime, 0.05);
  }

  getDevices() {
    return navigator.mediaDevices.enumerateDevices()
      .then((devices) => devices.filter((d) => d.kind === 'audioinput'))
      .catch(() => []);
  }

  stop() {
    if (this.monitorTimer) { clearInterval(this.monitorTimer); this.monitorTimer = null; }
    for (const node of this.nodes) { try { node.disconnect(); } catch (_) { /* ignore */ } }
    this.nodes = [];
    if (this.stream) { this.stream.getTracks().forEach((track) => track.stop()); this.stream = null; }
    if (this.ctx) { this.ctx.close().catch(() => {}); this.ctx = null; }
    this.processed = null;
    this.analyser = null;
    this.captureNode = null;
    this.gateGain = null;
    this.preGain = null;
    this.level = 0;
    this.voice = false;
  }
}

/** Small PCM playback scheduler used by the UDP compatibility mode. */
export class PCMPlayer {
  constructor() {
    this.ctx = null;
    this.node = null;
    this.gain = null;
    this.ready = false;
  }

  async start() {
    this.stop();
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AudioCtx({ latencyHint: 'interactive' });
    await this.ctx.audioWorklet.addModule('./js/worklets/pcm-playback.js');
    this.node = new AudioWorkletNode(this.ctx, 'pcm-playback', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1] });
    this.gain = this.ctx.createGain();
    this.gain.gain.value = 0.9;
    this.node.connect(this.gain);
    this.gain.connect(this.ctx.destination);
    this.node.port.onmessage = (event) => {
      if (event.data && event.data.type === 'underrun') this.ready = false;
    };
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    this.ready = true;
  }

  feed(int16) {
    if (!this.ready || !this.node) return;
    const float = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) float[i] = int16[i] / 32768;
    this.node.port.postMessage({ frame: float }, [float.buffer]);
  }

  setVolume(value) {
    if (this.gain) this.gain.gain.setTargetAtTime(Math.max(0, Math.min(2, Number(value) || 0)), this.ctx.currentTime, 0.02);
  }

  stop() {
    if (this.node) { try { this.node.disconnect(); } catch (_) { /* ignore */ } }
    if (this.gain) { try { this.gain.disconnect(); } catch (_) { /* ignore */ } }
    if (this.ctx) this.ctx.close().catch(() => {});
    this.node = null;
    this.gain = null;
    this.ctx = null;
    this.ready = false;
  }
}

export const micEV = new MicEV();
