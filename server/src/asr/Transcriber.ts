import { EventEmitter } from 'node:events';
import { trimOverlap } from '../seg/align.js';
import type { AsrSession } from './LiveSession.js';

const RING_SEC = 30;
const SILENCE_GATE_MS = 2000;     // stop sending after 2 s of silence
const PREROLL_CHUNKS = 3;         // 300 ms of pre-roll when speech resumes
const SWAP_SILENCE_MS = 400;
const PREV_GRACE_MS = 3000;       // the old session is closed this long after a swap
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
  /** F17.2 hybrid VAD: send audioStreamEnd after this much silence (0 = only the ASR's own endpointing). */
  vadEndMs?: number;
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

  // hybrid VAD (F17.2): audioStreamEnd at each pause, once per pause, only after speech was sent
  vadEnds = 0;
  private speechSent = false;
  private endSent = false;
  private vadEndClock: number | null = null;

  // overlap trimming after a hard cut / reconnect
  private trimRef: string | null = null;
  private prevText = '';            // latest text seen from the session being replaced
  private openText = '';            // current session's utterance in progress (last interim)
  private prevOpen = '';            // the old session's utterance in progress at the swap
  private holdNew = false;          // new session's output waits for the old session's final
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

  /** No more audio is coming: ask the current session to finish the utterance in progress. */
  endInput(): void {
    this.cur?.s.end();
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
    this.maybeEndTurn(silentForMs);
    if (this.holdNew && this.now() - this.swapAt > PREV_GRACE_MS) this.finishPrev('');
  }

  /**
   * Hybrid VAD (F17.2): once the meter has seen `vadEndMs` of silence after speech, tell the session the
   * turn is over so it emits the final now instead of waiting for its own endpointing. Sent after flush()
   * so every speech chunk is already in; never twice for one pause; not while a swap holds the new session.
   * The clock of the last speech chunk becomes the utterance's t1 (exact end of speech for the benchmark).
   */
  private maybeEndTurn(silentForMs: number): void {
    if (silentForMs === 0) { this.endSent = false; return; }
    const ms = this.opts.vadEndMs ?? 0;
    if (!ms || silentForMs < ms || this.endSent || !this.speechSent || this.holdNew || !this.cur?.ready) return;
    this.endSent = true;
    this.speechSent = false;
    this.vadEndClock = this.lastSpeech;
    this.vadEnds++;
    this.cur.s.end();
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

  /**
   * Make-before-break. The old session gets audioStreamEnd and answers with its final (the full,
   * corrected utterance) within about a second; a fresh session may take many seconds to produce
   * its first interim. So the new session's output is held until the old final arrives (or 3 s,
   * then the old session's last interim is used), published after it, and from then on the old
   * session is ignored — a late final would land in the middle of the next utterance.
   */
  private swap(overlapSec: number): void {
    const t = this.now();
    const old = this.cur!;
    this.prev?.close();
    this.prevOpen = this.openText;
    this.openText = '';
    this.prev = old.s;
    this.cur = this.next!;
    this.next = undefined;
    this.rotateRequested = false;
    this.rotations++;
    this.holdNew = true;
    this.held = [];
    this.swapAt = t;
    this.trimRef = this.prevOpen || this.prevText;
    if (overlapSec) this.sentClock = Math.max(-1, this.sentClock - overlapSec);
    this.pendingTrim = overlapSec > 0;
    const prevToClose = old.s;
    setTimeout(() => prevToClose.close(), PREV_GRACE_MS + 2000).unref?.();
    old.s.end();
    const gap = this.now() - t;
    this.maxGapMs = Math.max(this.maxGapMs, gap);
    console.log(`[${this.opts.label}] asr rotation #${this.rotations}${overlapSec ? ' (hard cut, 2 s overlap)' : ' (at silence)'}`);
    this.emit('rotation', gap);
  }

  /** The old session is done (its final, or the timeout): publish its utterance, then the held output. */
  private finishPrev(finalText: string): void {
    if (!this.holdNew) return;
    this.holdNew = false;
    const text = finalText || this.prevOpen;
    this.prevOpen = '';
    if (text) {
      this.trimRef = text;
      this.emitFinal(text);
    }
    const held = this.held;
    this.held = [];
    for (let i = 0; i < held.length; i++) {
      const [type, t] = held[i];
      if (type === 'interim' && held[i + 1]?.[0] === 'interim') continue;   // only the latest interim
      this.deliver(type, t);
    }
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
    if (s === this.prev) { this.finishPrev(''); this.prev = undefined; return; }
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
      this.openText = '';
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
    if (e.silentForMs === 0) this.speechSent = true;
  }

  // ── text ──

  private onText(s: AsrSession, type: 'interim' | 'final', text: string): void {
    if (s === this.prev) {
      if (!this.holdNew) return;            // already handed over: ignore late messages
      if (type === 'final') this.finishPrev(text);
      else this.prevOpen = text;
      return;
    }
    if (s !== this.cur?.s) return;
    this.prevText = text;
    this.openText = type === 'interim' ? text : '';
    if (this.holdNew) { this.held.push([type, text]); return; }
    this.deliver(type, text);
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
    // the pause that closed this utterance (hybrid VAD) is its exact end; a stale one from before the
    // current utterance started is ignored (the ASR closed that pause on its own before we did)
    const vadEnd = this.vadEndClock;
    this.vadEndClock = null;
    const closedByUs = vadEnd !== null && vadEnd > this.lastFinalT1 && (this.uttStart === null || vadEnd >= this.uttStart);
    const t1 = closedByUs ? vadEnd : Math.max(this.lastSpeech, this.lastFinalT1);
    const t0 = Math.min(this.uttStart ?? this.lastFinalT1, t1);
    this.lastFinalT1 = t1;
    // if the speaker is still talking, the next utterance starts right here
    const last = this.ring.at(-1);
    this.uttStart = last && last.silentForMs === 0 ? t1 : null;
    if (text.trim()) this.emit('final', text, t0, t1);
  }
}
