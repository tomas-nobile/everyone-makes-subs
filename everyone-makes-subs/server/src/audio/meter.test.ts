import { describe, expect, it } from 'vitest';
import { CHUNK_BYTES } from './chunker.js';
import { Meter, rms } from './meter.js';

const silence = () => Buffer.alloc(CHUNK_BYTES);

function sine(amplitude: number, freq = 440): Buffer {
  const buf = Buffer.alloc(CHUNK_BYTES);
  for (let i = 0; i < CHUNK_BYTES / 2; i++) {
    buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * freq * i) / 16000) * amplitude * 32767), i * 2);
  }
  return buf;
}

describe('Meter', () => {
  it('computes RMS normalized to 0–1', () => {
    expect(rms(silence())).toBe(0);
    expect(rms(sine(1))).toBeCloseTo(Math.SQRT1_2, 2);
  });

  it('detects silence only after more than 400 ms of zero buffers', () => {
    const m = new Meter();
    for (let i = 0; i < 4; i++) m.push(silence());
    expect(m.isSpeech).toBe(true); // 400 ms: not yet
    m.push(silence());
    expect(m.isSpeech).toBe(false);
    expect(m.silentForMs).toBe(500);
  });

  it('detects speech on a sine wave, even after 30 s of loud signal', () => {
    const m = new Meter();
    for (let i = 0; i < 20; i++) m.push(silence());
    for (let i = 0; i < 300; i++) m.push(sine(0.5));
    expect(m.isSpeech).toBe(true);
    expect(m.silentForMs).toBe(0);
    expect(m.level).toBeGreaterThan(0.8);
  });

  it('calibrates the threshold above a noise floor', () => {
    const m = new Meter();
    for (let i = 0; i < 300; i++) m.push(sine(0.005)); // quiet hum
    for (let i = 0; i < 5; i++) m.push(sine(0.005));
    expect(m.isSpeech).toBe(false);
    m.push(sine(0.3));
    expect(m.isSpeech).toBe(true);
  });

  it('emits the level 4 times per second of audio', () => {
    const levels: number[] = [];
    const m = new Meter((v) => levels.push(v));
    for (let i = 0; i < 100; i++) m.push(sine(0.5)); // 10 s
    expect(levels).toHaveLength(40);
  });
});
