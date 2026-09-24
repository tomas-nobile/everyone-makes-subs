import { BYTES_PER_SEC } from './chunker.js';

const HISTORY_CHUNKS = 300;       // 30 s of 100 ms chunks
const SILENCE_MS = 400;
const THRESHOLD_MIN = 0.002;      // floor: pure digital silence never counts as speech
const THRESHOLD_MAX = 0.05;       // cap: a long loud stretch can't calibrate speech into "silence"
const LEVEL_EVERY_MS = 250;       // 4 level events per second of audio

/** RMS of s16le samples, normalized 0–1 (1 = full-scale square wave). */
export function rms(chunk: Buffer): number {
  const n = Math.floor(chunk.length / 2);
  if (n === 0) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const s = chunk.readInt16LE(i * 2) / 32768;
    sum += s * s;
  }
  return Math.sqrt(sum / n);
}

/** Perceptual 0–1 level for the VU meter: -60 dBFS → 0, 0 dBFS → 1. */
export function toLevel(r: number): number {
  if (r <= 0) return 0;
  return Math.min(1, Math.max(0, (20 * Math.log10(r) + 60) / 60));
}

/**
 * Energy-based VAD. Silence = RMS below the threshold for more than 400 ms.
 * Threshold self-calibrates: 10th percentile of the last 30 s of RMS × 2 (clamped).
 */
export class Meter {
  level = 0;
  silentForMs = 0;
  threshold = THRESHOLD_MIN;
  private history: number[] = [];
  private sinceLevelMs = 0;
  private peak = 0;

  constructor(private onLevel?: (v: number) => void) {}

  get isSpeech(): boolean {
    return this.silentForMs <= SILENCE_MS;
  }

  push(chunk: Buffer): void {
    const r = rms(chunk);
    const ms = (chunk.length / BYTES_PER_SEC) * 1000;

    this.threshold = this.calibrate();
    this.history.push(r);
    if (this.history.length > HISTORY_CHUNKS) this.history.shift();

    this.silentForMs = r < this.threshold ? this.silentForMs + ms : 0;
    this.level = toLevel(r);

    this.peak = Math.max(this.peak, this.level);
    this.sinceLevelMs += ms;
    if (this.sinceLevelMs >= LEVEL_EVERY_MS) {
      this.sinceLevelMs -= LEVEL_EVERY_MS;
      this.onLevel?.(Math.round(this.peak * 100) / 100);
      this.peak = 0;
    }
  }

  private calibrate(): number {
    if (this.history.length === 0) return THRESHOLD_MIN;
    const sorted = [...this.history].sort((a, b) => a - b);
    const p10 = sorted[Math.floor(sorted.length * 0.1)];
    return Math.min(THRESHOLD_MAX, Math.max(THRESHOLD_MIN, p10 * 2));
  }
}
