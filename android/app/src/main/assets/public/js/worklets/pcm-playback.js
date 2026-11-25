class PCMPlaybackProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.capacity = 96000; // 6 seconds at 16 kHz
    this.ring = new Float32Array(this.capacity);
    this.write = 0;
    this.read = 0;
    this.phase = 0;
    this.available = 0;
    this.lastUnderrun = 0;
    this.port.onmessage = (event) => {
      const frame = event.data && event.data.frame;
      if (!frame || !frame.length) return;
      for (let i = 0; i < frame.length; i++) {
        this.ring[this.write] = frame[i];
        this.write = (this.write + 1) % this.capacity;
      }
      this.available = Math.min(this.capacity, this.available + frame.length);
    };
  }

  process(_inputs, outputs) {
    const output = outputs[0];
    if (!output || !output[0]) return true;
    const channel = output[0];
    const ratio = Math.max(1, Math.round(sampleRate / 16000));
    for (let i = 0; i < channel.length; i++) {
      if (this.available > 0) {
        channel[i] = this.ring[this.read];
        this.phase++;
        if (this.phase >= ratio) {
          this.phase = 0;
          this.read = (this.read + 1) % this.capacity;
          this.available--;
        }
      } else {
        channel[i] = 0;
        if (this.lastUnderrun++ > 4800) {
          this.port.postMessage({ type: 'underrun' });
          this.lastUnderrun = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor('pcm-playback', PCMPlaybackProcessor);
