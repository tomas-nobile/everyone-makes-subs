// AudioWorkletProcessor: downsamples the mic input (whatever the device's native rate is) to
// 16 kHz mono, converts to Int16, and posts ~100ms chunks (1600 samples / 3200 bytes) back to the
// main thread — matching the project's internal audio convention (docs/architecture.md).
//
// This file runs in the AudioWorkletGlobalScope, which isn't part of this project's "dom" lib, so
// its globals are declared by hand below (erased at compile time; the real ones exist at runtime).
export {};

declare global {
  const sampleRate: number;
  class AudioWorkletProcessor {
    readonly port: MessagePort;
    constructor(options?: unknown);
    process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean;
  }
  function registerProcessor(name: string, ctor: new (options?: unknown) => AudioWorkletProcessor): void;
}

const CHUNK_SAMPLES = 1600; // 100ms @ 16kHz

class PcmDownsampler extends AudioWorkletProcessor {
  private readonly ratio: number;
  private pos = 0;
  private buffer: number[] = [];

  constructor() {
    super();
    this.ratio = sampleRate / 16000;
  }

  process(inputs: Float32Array[][]): boolean {
    const input = inputs[0]?.[0];
    if (!input || input.length === 0) return true;
    while (this.pos < input.length) {
      const i0 = Math.floor(this.pos);
      const i1 = Math.min(i0 + 1, input.length - 1);
      const frac = this.pos - i0;
      this.buffer.push(input[i0] + (input[i1] - input[i0]) * frac);
      this.pos += this.ratio;
      if (this.buffer.length >= CHUNK_SAMPLES) this.flush();
    }
    this.pos -= input.length;
    return true;
  }

  private flush(): void {
    const out = new Int16Array(this.buffer.length);
    for (let i = 0; i < this.buffer.length; i++) {
      const s = Math.max(-1, Math.min(1, this.buffer[i]));
      out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    this.buffer = [];
    this.port.postMessage(out.buffer, [out.buffer]);
  }
}

registerProcessor('pcm-downsampler', PcmDownsampler);
