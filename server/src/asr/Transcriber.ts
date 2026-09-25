import { EventEmitter } from 'node:events';
import { trimOverlap } from '../seg/align.js';
import type { AsrSession } from './LiveSession.js';

const RING_SEC = 30;
const SILENCE_GATE_MS = 2000;     // stop sending after 2 s of silence
const PREROLL_CHUNKS = 3;         // 300 ms of pre-roll when speech resumes
const SWAP_SILENCE_MS = 400;
const PREV_GRACE_MS = 3000;       // finals from the old session keep flowing this long
const OVERLAP_SEC = 2;
const RECONNECT_OVERLAP_SEC = 1;
const MAX_BACKLOG_SEC = 10;
const MAX_BACKOFF_MS = 30_000;

interface Entry { chunk: Buffer; clock: number; silentForMs: number }
interface Slot { s: AsrSession; ready: boolean; startedAt: number }

export interface TranscriberOptions {
  label: string;
  factory: () => AsrSession;
  rotateSec: number;
  hardCutSec: number;
  now?: () => number;
}

/**
 * Feeds audio to the ASR and hides its sessions (docs/architecture.md → "3. TranscribeSession").
 * - Sends only speech (+300 ms pre-roll after > 2 s of silence) and counts the seconds sent.
 * - Rotation make-before-break: pre-connect at ROTATE−5 s, swap at the first 400 ms silence after
 *   ROTATE (or when requested), hard cut with 2 s of overlap at HARD_CUT.
 * - Reconnects on GoAway/unexpected close with backoff, resending what the ASR missed.
 * Events: 'interim' (text), 'final' (text, t0, t1), 'rotation' (gapMs), 'reconnect', 'asr-error'.
 */
export class Transcriber extends EventEmitter {
  sentSec = 0;
  rotations = 0;
  maxGapMs = 0;
  reconnects = 0;
  backlogSec = 0;

  private cur?: Slot;
  private next?: Slot;
  private prev?: AsrSession;
  private ring: Entry[] = [];
  private sentClock = -1;          // clock of the last entry sent to the current session
  private gated = false;
  private rotateRequested = false;
  private attempt = 0;
  private reconnectTimer?: NodeJS.Timeout;
  private stopped = false;
  private now: () => number;

  // timing of the current utterance (audio clock, seconds)
  private uttStart: number | null = null;
  private lastSpeech = 0;
  private lastFinalT1 = 0;

  // overlap trimming after a hard cut / reconnect
  private trimRef: string | null = null;
  private prevText = '';            // latest text seen from the session being replaced
  private holdNew = false;          // hold the new session's output until the old one is done
  private held: Array<['interim' | 'final', string]> = [];
  private swapAt = 0;

  constructor(private opts: TranscriberOptions) {
    super();
    this.now = opts.now ?? Date.now;
  }

  start(): void {
    this.stopped = false;
    this.cur = this.open();
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.reconnectTimer);
    for (const s of [this.cur?.s, this.next?.s, this.prev]) s?.close();
    this.cur = this.next = this.prev = undefined;
  }

  requestRotation(): void {
    this.rotateRequested = true;
  }

  /** Audio clock where the current utterance started (null between utterances). */
  get utteranceStart(): number | null {
    return this.uttStart;
  }

  get lastSpeechClock(): number {
    return this.lastSpeech;
  }

  /** Current session's age in seconds (for metrics). */
  get sessionAgeSec(): number {
    return this.cur ? (this.now() - this.cur.startedAt) / 1000 : 0;
  }

  push(chunk: Buffer, clock: number, silentForMs: number): void {
    this.ring.push({ chunk, clock, silentForMs });
    while (this.ring.length && this.ring[0].clock < clock - RING_SEC) this.ring.shift();
    if (silentForMs === 0) {
      this.lastSpeech = clock;
      if (this.uttStart === null) this.uttStart = Math.max(this.lastFinalT1, clock - 0.1);
    }
    if (this.stopped || !this.cur) return;
    this.maybeRotate(silentForMs);
    this.flush();
    if (this.holdNew && this.now() - this.swapAt > PREV_GRACE_MS) this.releaseHeld();
  }

  // ── sessions ──

  private open(): Slot {
    const s = this.opts.factory();
    const slot: Slot = { s, ready: false, startedAt: this.now() };
    s.ready.then(() => { slot.ready = true; if (slot === this.cur) this.flush(); }, () => {});
    s.on('interim', (text: string) => this.onText(s, 'interim', text));
    s.on('final', (text: string) => this.onText(s, 'final', text));
    s.on('goaway', () => this.onGoAway(s));
    s.on('close', (reason: string, unexpected: boolean) => this.onClose(s, reason, unexpected));
    return slot;
  }

  private maybeRotate(silentForMs: number): void {
    const cur = this.cur!;
    const e = (this.now() - cur.startedAt) / 1000;
    if ((e >= this.opts.rotateSec - 5 || this.rotateRequested) && !this.next) this.next = this.open();
    if (!this.next?.ready) return;
    if ((e >= this.opts.rotateSec || this.rotateRequested) && silentForMs >= SWAP_SILENCE_MS) this.swap(0);
    else if (e >= this.opts.hardCutSec) this.swap(OVERLAP_SEC);
  }

  private swap(overlapSec: number): void {
    const t = this.now();
    const old = this.cur!;
    old.s.end();
    this.prev?.close();
    this.prev = old.s;
    const prevToClose = old.s;
    setTimeout(() => { prevToClose.close(); if (this.prev === prevToClose) this.releaseHeld(); }, PREV_GRACE_MS).unref?.();
    this.cur = this.next!;
    this.next = undefined;
    this.rotateRequested = false;
    this.rotations++;
    this.holdNew = true;
    this.held = [];
    this.swapAt = t;
    if (overlapSec) {
      this.trimRef = this.prevText;     // updated again if the old session's final arrives later
      this.sentClock = Math.max(-1, this.sentClock - overlapSec);
    }
    this.pendingTrim = overlapSec > 0;
    const gap = this.now() - t;
    this.maxGapMs = Math.max(this.maxGapMs, gap);
    console.log(`[${this.opts.label}] asr rotation #${this.rotations}${overlapSec ? ' (hard cut, 2 s overlap)' : ' (at silence)'}`);
    this.emit('rotation', gap);
  }

  private pendingTrim = false;

  private onGoAway(s: AsrSession): void {
    if (s !== this.cur?.s) return;
    console.log(`[${this.opts.label}] asr goAway: rotating at the next silence`);
    this.rotateRequested = true;
    if (!this.next) this.next = this.open();
    // if there is no silence soon, the hard cut below the session limit still applies
  }

  private onClose(s: AsrSession, reason: string, unexpected: boolean): void {
    if (s === this.prev) { this.prev = undefined; this.releaseHeld(); return; }
    if (s === this.next?.s) { this.next = undefined; return; }
    if (s !== this.cur?.s || this.stopped || !unexpected) return;
    // Unexpected close of the current session → reconnect with backoff, resend what it missed.
    this.reconnects++;
    this.emit('asr-error', reason);
    console.log(`[${this.opts.label}] asr closed unexpectedly (${reason}); reconnecting`);
    this.cur = undefined;
    const delay = this.attempt === 0 ? 0 : Math.min(MAX_BACKOFF_MS, 1000 * 2 ** (this.attempt - 1));
    this.attempt++;
    this.reconnectTimer = setTimeout(() => {
      if (this.stopped) return;
      if (this.next) { this.cur = this.next; this.next = undefined; } else this.cur = this.open();
      this.sentClock = Math.max(-1, this.sentClock - RECONNECT_OVERLAP_SEC);
      this.pendingTrim = true;
      this.trimRef = this.prevText;
      this.emit('reconnect');
      this.flush();
    }, delay);
  }

  // ── audio ──

  private flush(): void {
    const cur = this.cur;
    if (!cur?.ready) return;
    let pending = this.ring.filter((e) => e.clock > this.sentClock);
    const backlog = pending.length ? pending.at(-1)!.clock - pending[0].clock : 0;
    this.backlogSec = backlog;
    if (backlog > MAX_BACKLOG_SEC) pending = pending.filter((e) => e.silentForMs < SWAP_SILENCE_MS);
    for (const e of pending) {
      this.sentClock = e.clock;
      if (e.silentForMs > SILENCE_GATE_MS) { this.gated = true; continue; }
      if (this.gated) {
        this.gated = false;
        const pre = this.ring.filter((x) => x.clock < e.clock).slice(-PREROLL_CHUNKS);
        for (const p of pre) this.sendOne(cur.s, p);
      }
      this.sendOne(cur.s, e);
    }
    if (pending.length) this.attempt = 0;
  }

  private sendOne(s: AsrSession, e: Entry): void {
    s.send(e.chunk);
    this.sentSec += e.chunk.length / 32_000;
  }

  // ── text ──

  private onText(s: AsrSession, type: 'interim' | 'final', text: string): void {
    if (s === this.prev) {
      // old session after a swap: its final still counts and is the reference for the overlap trim
      this.trimRef = text;
      if (type === 'final') this.emitFinal(text);
      return;
    }
    if (s !== this.cur?.s) return;
    this.prevText = text;
    if (this.holdNew) { this.held.push([type, text]); return; }
    this.deliver(type, text);
  }

  private releaseHeld(): void {
    if (!this.holdNew) return;
    this.holdNew = false;
    const held = this.held;
    this.held = [];
    // keep only the latest interim before each final
    for (let i = 0; i < held.length; i++) {
      const [type, text] = held[i];
      if (type === 'interim' && held[i + 1]?.[0] === 'interim') continue;
      this.deliver(type, text);
    }
  }

  private deliver(type: 'interim' | 'final', raw: string): void {
    let text = raw;
    if (this.pendingTrim && this.trimRef) {
      text = trimOverlap(this.trimRef, raw);
      if (type === 'final') this.pendingTrim = false;
    } else if (type === 'final') this.pendingTrim = false;
    if (type === 'interim') { if (text) this.emit('interim', text); return; }
    this.emitFinal(text);
  }

  private emitFinal(text: string): void {
    const t1 = Math.max(this.lastSpeech, this.lastFinalT1);
    const t0 = Math.min(this.uttStart ?? this.lastFinalT1, t1);
    this.lastFinalT1 = t1;
    // if the speaker is still talking, the next utterance starts right here
    const last = this.ring.at(-1);
    this.uttStart = last && last.silentForMs === 0 ? t1 : null;
    if (text.trim()) this.emit('final', text, t0, t1);
  }
}
