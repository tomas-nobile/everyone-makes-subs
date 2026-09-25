/**
 * FakeBackend: replays samples/*.transcript.json with the file's timing and emits the same
 * events as the real pipeline (live, segment, tr, state, level). No key and no audio needed.
 *
 * .transcript.json format:
 * {
 *   "lang": "es",                       // language of the talk
 *   "title": "…", "speaker": "…",       // used for the fake Talk
 *   "durationSec": 64.8,                // loop length (optional; default = last event t + 2)
 *   "events": [                         // sorted by t
 *     { "t": 1.2, "type": "interim", "text": "Hola a todos" },
 *         // t = seconds since the start of the audio when the event is emitted.
 *         // text = accumulated interim of the current utterance → SSE `live`.
 *     { "t": 2.9, "type": "final", "text": "Hola a todos.", "src": "es",
 *       "t0": 0.6, "t1": 2.6, "kind": "speech",           // speech | sound | audience
 *       "tr": { "es": "…", "en": "…", "pt": "…" },        // null = translation failed
 *       "mtMs": 700 }
 *         // → SSE `segment` at t, then `tr` at t + mtMs.
 *   ]
 * }
 *
 * When the file ends: `state: paused` for the tail, then it loops (seq and t0/t1 keep growing).
 */
import fs from 'node:fs';
import type { SegmentKind, StageState } from '../../../shared/contract.js';
import type { SourceState } from '../audio/sources.js';
import type { EventBus } from '../bus/EventBus.js';
import type { Worker } from '../stage/StageWorker.js';

export type TranscriptEvent =
  | { t: number; type: 'interim'; text: string }
  | { t: number; type: 'final'; text: string; src: string; t0: number; t1: number;
      kind: SegmentKind; tr: Record<string, string | null>; mtMs?: number };

export interface Transcript {
  lang: string;
  title: string;
  speaker?: string;
  durationSec?: number;
  events: TranscriptEvent[];
}

const BENCH = process.env.BENCH === '1' || process.env.BENCH === 'true';

export function loadTranscript(file: string): Transcript {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as Transcript;
}

export class FakeBackend implements Worker {
  private timers = new Set<NodeJS.Timeout>();
  private levelTimer?: NodeJS.Timeout;
  private loop = 0;
  private speakingUntil = 0;
  private running = false;
  private startedAt = 0;
  sourceState: SourceState = 'connecting';
  fakeState: StageState = 'connecting';
  stats = { sentSec: 0, rotations: 0, maxGapMs: 0, reconnects: 0, backlogSec: 0 };

  constructor(
    private stageId: string,
    private bus: EventBus,
    private transcript: Transcript,
    private nextSeq: () => number,
  ) {}

  get silentForMs(): number {
    return Math.max(0, Date.now() - this.speakingUntil);
  }

  requestRotation(): void {
    this.stats.rotations++;
  }

  markTalkStart(): void { /* the replay keeps its own timeline */ }

  private setState(s: StageState): void {
    this.fakeState = s;
  }

  private get duration(): number {
    const last = this.transcript.events.at(-1)?.t ?? 0;
    return this.transcript.durationSec ?? last + 2;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.startedAt = Date.now();
    this.sourceState = 'live';
    console.log(`[${this.stageId}] fake backend: replaying "${this.transcript.title}" (${this.duration}s loop)`);
    this.levelTimer = setInterval(() => this.emitLevel(), 250);
    this.runLoop();
  }

  stop(): void {
    this.running = false;
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    clearInterval(this.levelTimer);
    this.sourceState = 'connecting';
    this.setState('idle');
  }

  private at(sec: number, fn: () => void): void {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      if (this.running) fn();
    }, Math.max(0, sec * 1000));
    this.timers.add(timer);
  }

  private runLoop(): void {
    const offset = this.loop * this.duration;
    this.setState('live');
    for (const ev of this.transcript.events) {
      if (ev.type === 'interim') {
        this.at(ev.t, () => {
          this.speakingUntil = Date.now() + 600;
          this.bus.publish({ type: 'live', text: ev.text });
        });
      } else {
        this.at(ev.t, () => {
          const seq = this.nextSeq();
          this.stats.sentSec = (Date.now() - this.startedAt) / 1000;
          const lag = Math.max(0.6, Math.round((ev.t - ev.t1 + 0.6) * 100) / 100);   // ≥ the ASR latency the live metric does not see
          const stamp = () => (BENCH ? { at: Date.now() } : {});   // F17.1: delivery (publish → receive) is measurable in fake mode too
          this.bus.publish({ type: 'segment', seq, src: ev.src, text: ev.text, t0: ev.t0 + offset, t1: ev.t1 + offset, kind: ev.kind, lag, ...stamp() });
          const mtMs = ev.mtMs ?? 600;
          this.at(mtMs / 1000, () => this.bus.publish({ type: 'tr', seq, tr: ev.tr, ms: mtMs, ...stamp() }));
        });
      }
    }
    const lastT = this.transcript.events.at(-1)?.t ?? 0;
    // Silence at the end of the file: show the "paused" state, then loop.
    if (this.duration - lastT > 2) this.at(lastT + 1.5, () => this.setState('paused'));
    this.at(this.duration, () => {
      this.loop++;
      this.runLoop();
    });
  }

  private emitLevel(): void {
    const speaking = Date.now() < this.speakingUntil;
    const v = speaking ? 0.35 + Math.random() * 0.45 : Math.random() * 0.04;
    this.bus.publish({ type: 'level', v: Math.round(v * 100) / 100 });
  }
}
