class PCMCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.frame = new Float32Array(320); // 20 ms at 16 kHz
    this.index = 0;
    this.counter = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (input && input[0]) {
      const channel = input[0];
      const ratio = Math.max(1, Math.round(sampleRate / 16000));
      for (let i = 0; i < channel.length; i++) {
        if (this.counter++ % ratio !== 0) continue;
        this.frame[this.index++] = channel[i];
        if (this.index === this.frame.length) {
          this.port.postMessage({ frame: new Float32Array(this.frame) });
          this.index = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor('pcm-capture', PCMCaptureProcessor);
