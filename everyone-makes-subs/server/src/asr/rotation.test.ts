import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { norm } from '../seg/align.js';
import { Segmenter } from '../seg/Segmenter.js';
import type { AsrSession } from './LiveSession.js';
import { Transcriber } from './Transcriber.js';

// Fake ASR: each 100 ms chunk carries the index of the word being spoken (−1 = silence) in its
// first 4 bytes. It "hears" a word when the index changes, emits cumulative interims, a final
// after 500 ms of silence or on audioStreamEnd, and can be killed to simulate a dropped session.
let ids = 0;
let lastSender: FakeSession | undefined;
class FakeSession extends EventEmitter implements AsrSession {
  readonly id = ++ids;
  ready = Promise.resolve();
  private heard: number[] = [];
  private last = -1;
  private silent = 0;
  private closed = false;
  constructor(private vocab: string[]) { super(); }
  send(chunk: Buffer): void {
    if (this.closed) return;
    lastSender = this;
    const idx = chunk.readInt32LE(0);
    if (idx < 0) {
      this.silent++;
      this.last = -1;
      if (this.silent === 5) this.finalize();
      return;
    }
    this.silent = 0;
    if (idx !== this.last) {
      this.last = idx;
      this.heard.push(idx);
      this.emit('interim', this.text());
    }
  }
  private text(): string {
    return this.heard.map((i) => this.vocab[i]).join(' ');
  }
  private finalize(): void {
    if (this.heard.length) this.emit('final', this.text());
    this.heard = [];
  }
  end(): void { this.finalize(); }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    setImmediate(() => this.emit('close', 'closed', false));
  }
  kill(): void {
    this.finalize();
    this.closed = true;
    setImmediate(() => this.emit('close', 'killed', true));
  }
}

function buildTalk(nWords: number) {
  const vocab: string[] = [];
  const timeline: number[] = [];      // one entry per 100 ms chunk: word index or −1
  let rnd = 7;
  const rand = () => (rnd = (rnd * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
  let i = 0;
  while (i < nWords) {
    const len = 3 + Math.floor(rand() * 14);
    const runOn = rand() < 0.3 || (i > 180 && i < 300); // no pause after this sentence (and a long stretch that forces the hard cut)
    for (let k = 0; k < len && i < nWords; k++, i++) {
      vocab.push(`w${i}${k === len - 1 ? '.' : ''}`);
      timeline.push(i, i, i);
    }
    if (!runOn) for (let k = 0; k < 8; k++) timeline.push(-1);
  }
  return { vocab, timeline };
}

describe('rotation', () => {
  it('rotates, hard-cuts and reconnects with 0 duplicates and no gaps longer than 1 word', async () => {
    const { vocab, timeline } = buildTalk(600);
    let now = 0;
    const sessions: FakeSession[] = [];
    const tr = new Transcriber({
      label: 'test', rotateSec: 20, hardCutSec: 26, now: () => now,
      factory: () => { const s = new FakeSession(vocab); sessions.push(s); return s; },
    });
    const out: string[] = [];
    const seg = new Segmenter({ forceCommitMs: 4500, now: () => now, onCommit: (c) => out.push(c.text) });
    tr.on('interim', (t: string) => seg.onInterim(t));
    tr.on('final', (t: string) => seg.onFinal(t));
    tr.start();
    await new Promise((r) => setImmediate(r));

    let silentForMs = 0;
    const killAt = Math.floor(timeline.length * 0.6);
    for (let c = 0; c < timeline.length + 30; c++) {
      const idx = c < timeline.length ? timeline[c] : -1;
      const chunk = Buffer.alloc(3200);
      chunk.writeInt32LE(idx, 0);
      silentForMs = idx < 0 ? silentForMs + 100 : 0;
      now = c * 100;
      if (c === killAt) lastSender!.kill();
      tr.push(chunk, (c + 1) / 10, silentForMs);
      await new Promise((r) => setImmediate(r));
    }
    tr.stop();

    const got = out.join(' ').split(/\s+/).map(norm).filter(Boolean);
    const ref = vocab.map(norm);
    const counts = new Map<string, number>();
    for (const w of got) counts.set(w, (counts.get(w) ?? 0) + 1);
    const dups = [...counts].filter(([, n]) => n > 1).map(([w]) => w);
    let run = 0;
    let maxGap = 0;
    for (const w of ref) {
      run = counts.has(w) ? 0 : run + 1;
      maxGap = Math.max(maxGap, run);
    }
    expect(tr.rotations).toBeGreaterThanOrEqual(4);
    expect(tr.reconnects).toBe(1);
    expect(dups).toEqual([]);
    expect(maxGap).toBeLessThanOrEqual(1);
  });
});
