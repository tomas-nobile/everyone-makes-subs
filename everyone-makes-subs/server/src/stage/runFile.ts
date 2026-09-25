import { emptyGlossary, type Segment, type SegmentKind, type Talk } from '../../../shared/contract.js';
import type { TranscriptEvent } from '../asr/FakeBackend.js';
import { EventBus } from '../bus/EventBus.js';
import type { Config } from '../config.js';
import { StageWorker } from './StageWorker.js';

export interface FileRunOptions {
  cfg: Config;
  file: string;
  talk: Pick<Talk, 'title'> & Partial<Talk>;
  targetLangs: string[];
  /** Stop after this many seconds of audio (0 = whole file). */
  seconds?: number;
  /** F18.1: feed the audio at N× real time (1 = real time, as a live stage). */
  speed?: number;
  label?: string;
  onLine?: (line: string) => void;
}

export interface FileRunResult {
  segments: Segment[];
  /** Same events in the FakeBackend `.transcript.json` format (t = seconds since start). */
  events: TranscriptEvent[];
  durationSec: number;
  interims: number;
  mtMs: number[];
  lagSec: number[];
  sentSec: number;
  rotations: number;
  errors: number;
}

/**
 * Runs the real pipeline (Live API → segmenter → translator) over a file in real time, once,
 * and collects everything it published. Used by the verification scripts, the sample transcripts
 * (F01.3) and the subtitled demo clip (F15.2).
 */
export function runFile(opts: FileRunOptions): Promise<FileRunResult> {
  const label = opts.label ?? 'file';
  const log = opts.onLine ?? ((l: string) => console.log(l));
  const bus = new EventBus();
  const talk: Talk = { id: 'offline', stageId: label, status: 'live', glossary: emptyGlossary(), ...opts.talk } as Talk;
  let seq = 0;
  let errors = 0;
  const started = Date.now();
  const since = () => Math.round((Date.now() - started) / 10) / 100;

  const segments = new Map<number, Segment>();
  const publishedAt = new Map<number, number>();
  const events: TranscriptEvent[] = [];
  let interims = 0;
  const mtMs: number[] = [];
  const lagSec: number[] = [];

  bus.subscribe(({ ev }) => {
    if (ev.type === 'live' && ev.text) {
      interims++;
      events.push({ t: since(), type: 'interim', text: ev.text });
    } else if (ev.type === 'segment') {
      segments.set(ev.seq, { seq: ev.seq, talkId: talk.id, src: ev.src, text: ev.text, tr: {}, t0: ev.t0, t1: ev.t1, kind: ev.kind, ms: { asr: Math.round((ev.lag ?? 0) * 1000) }, ...(ev.u ? { u: ev.u } : {}) });
      publishedAt.set(ev.seq, since());
      if (ev.lag !== undefined) lagSec.push(ev.lag);
      log(`[${label}] ${ev.t0.toFixed(2)}–${ev.t1.toFixed(2)} s · lag ${ev.lag?.toFixed(2) ?? '?'} s · ${ev.kind === 'speech' ? '' : `(${ev.kind}) `}${ev.text}`);
    } else if (ev.type === 'tr') {
      // F17.4: partial `tr` events (es first) are merged; the first one's ms is the Spanish latency
      const s = segments.get(ev.seq);
      if (!s) return;
      s.tr = { ...s.tr, ...ev.tr };
      if (s.ms.mt === undefined) { s.ms.mt = ev.ms; if (ev.ms) mtMs.push(ev.ms); }
      for (const [l, t] of Object.entries(ev.tr)) if (l !== s.src) log(`          ${l}: ${t ?? '(null: translation failed)'}`);
    }
  });
  const complete = (s: Segment) => opts.targetLangs.every((l) => l in s.tr);

  const worker = new StageWorker(
    { id: label, name: label, source: { kind: 'file', path: opts.file }, targetLangs: opts.targetLangs, state: 'live', viewers: 0 },
    { cfg: opts.cfg, bus, getTalk: () => talk, nextSeq: () => ++seq, onError: () => errors++, onSourceEnd: () => finish('end of file'), speed: opts.speed },
  );

  let done: (r: FileRunResult) => void;
  const result = new Promise<FileRunResult>((r) => { done = r; });
  let finishing = false;
  function finish(why: string): void {
    if (finishing) return;
    finishing = true;
    log(`[${label}] ${why}: closing the last utterance and waiting for translations…`);
    worker.endInput();
    // the last final needs a few seconds after the end of the audio, and every phrase its
    // translation (on the free tier they can queue behind the quota): wait for both, 60 s max
    const endedAt = Date.now();
    const waiting = setInterval(() => {
      const pending = [...segments.values()].filter((s) => !complete(s)).length;
      if ((Date.now() - endedAt < 5000 || pending > 0) && Date.now() - endedAt < 60_000) return;
      clearInterval(waiting);
      if (pending) log(`[${label}] ${pending} translation(s) still missing after 60 s`);
      const stats = worker.stats;
      worker.stop();
      clearInterval(timer);
      const segs = [...segments.values()].sort((a, b) => a.seq - b.seq);
      for (const s of segs) {
        events.push({
          t: publishedAt.get(s.seq) ?? 0, type: 'final', text: s.text, src: s.src || talk.lang || '', t0: s.t0, t1: s.t1,
          kind: s.kind as SegmentKind, tr: s.tr, mtMs: s.ms.mt, ...(s.ms.asr ? { lag: s.ms.asr / 1000 } : {}), ...(s.u ? { u: s.u } : {}),
        });
      }
      events.sort((a, b) => a.t - b.t);
      done({ segments: segs, events, durationSec: since(), interims, mtMs, lagSec, sentSec: stats.sentSec, rotations: stats.rotations, errors });
    }, 250);
  }

  const timer = setInterval(() => {
    if (opts.seconds && Date.now() - started >= opts.seconds * 1000) finish(`${opts.seconds} s reached`);
  }, 250);
  worker.start();
  return result;
}

export function pct(xs: number[], p: number): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))];
}
