import type { Stage, Talk } from '../../../shared/contract.js';
import { LiveSession } from '../asr/LiveSession.js';
import { Transcriber } from '../asr/Transcriber.js';
import { AudioSource, StationSource, type SourceState } from '../audio/sources.js';
import { Meter } from '../audio/meter.js';
import type { EventBus } from '../bus/EventBus.js';
import type { Config } from '../config.js';
import { Translator } from '../mt/Translator.js';
import { Segmenter, type Commit } from '../seg/Segmenter.js';
import { words } from '../seg/align.js';

export interface WorkerDeps {
  cfg: Config;
  bus: EventBus;
  getTalk: () => Talk | null;
  nextSeq: () => number;
  onError: (status: number) => void;
}

/** Common surface of the real pipeline and the fake replay, as the StageManager sees it. */
export interface Worker {
  start(): void;
  stop(): void;
  requestRotation(): void;
  markTalkStart(): void;
  ingest?(data: Buffer): void;
  readonly sourceState: SourceState;
  readonly silentForMs: number;
  readonly stats: { sentSec: number; rotations: number; maxGapMs: number; reconnects: number; backlogSec: number };
}

/**
 * One stage's real pipeline: source → meter → transcriber (Live API, rotation) → segmenter →
 * translator → bus. Every failure stays inside the worker; the other stages are unaffected.
 */
export class StageWorker implements Worker {
  private source: AudioSource | StationSource;
  private meter: Meter;
  private transcriber: Transcriber;
  private segmenter: Segmenter;
  private translator: Translator;
  private wall: Array<[number, number]> = [];   // [audio clock, wall ms] for latency
  private talkOffset = 0;
  private lastCommitT1: number | null = null;
  private finalTimes: { t0: number; t1: number } | null = null;
  private prevInterim: string[] = [];
  private label: string;

  constructor(private stage: Stage, private deps: WorkerDeps) {
    const { cfg, bus } = deps;
    this.label = stage.id;
    this.source = stage.source.kind === 'station' ? new StationSource(stage.id) : new AudioSource(stage.source, stage.id, cfg.dataDir);
    this.meter = new Meter((v) => bus.publish({ type: 'level', v }));
    this.transcriber = new Transcriber({
      label: stage.id,
      rotateSec: cfg.sessionRotateSec,
      hardCutSec: cfg.sessionHardCutSec,
      factory: () => {
        const talk = deps.getTalk();
        return new LiveSession({ apiKey: cfg.geminiApiKey, model: cfg.transcribeModel, lang: talk?.lang, vocabulary: talk?.glossary.asrVocabulary ?? [], label: stage.id });
      },
    });
    this.segmenter = new Segmenter({
      forceCommitMs: cfg.forceCommitMs,
      replacements: () => deps.getTalk()?.glossary.replacements ?? {},
      onCommit: (c) => this.onCommit(c),
    });
    this.translator = new Translator(stage.id, cfg, deps.getTalk, () => this.stage.targetLangs, deps.onError);

    this.source.on('chunk', (chunk: Buffer) => {
      const clock = this.source.clock;
      this.meter.push(chunk);
      this.wall.push([clock, Date.now()]);
      if (this.wall.length > 600) this.wall.shift();
      this.transcriber.push(chunk, clock, this.meter.silentForMs);
    });
    this.transcriber.on('interim', (text: string) => {
      this.segmenter.onInterim(text);
      bus.publish({ type: 'live', text: this.mask(text) });
    });
    this.transcriber.on('final', (text: string, t0: number, t1: number) => {
      this.finalTimes = { t0, t1 };
      this.segmenter.onFinal(text);
      this.finalTimes = null;
      this.lastCommitT1 = null;
      this.prevInterim = [];
      bus.publish({ type: 'live', text: '' });
    });
    this.transcriber.on('asr-error', () => deps.onError(0));
  }

  get sourceState(): SourceState { return this.source.state; }
  get silentForMs(): number { return this.meter.silentForMs; }
  get stats() {
    const t = this.transcriber;
    return { sentSec: t.sentSec, rotations: t.rotations, maxGapMs: t.maxGapMs, reconnects: t.reconnects, backlogSec: t.backlogSec };
  }

  start(): void {
    if (!this.deps.cfg.geminiApiKey) console.log(`[${this.label}] no Gemini key: audio runs but nothing is transcribed`);
    this.source.start();
    if (this.deps.cfg.geminiApiKey) this.transcriber.start();
  }

  stop(): void {
    this.source.stop();
    this.transcriber.stop();
  }

  requestRotation(): void {
    this.transcriber.requestRotation();
  }

  markTalkStart(): void {
    this.talkOffset = this.source.clock;
  }

  ingest(data: Buffer): void {
    if (this.source instanceof StationSource) this.source.ingest(data);
  }

  /** `live` masking: the last 2 words only show once the previous interim agrees on them. */
  private mask(text: string): string {
    const ws = words(text);
    const prev = this.prevInterim;
    this.prevInterim = ws;
    let keep = Math.max(0, ws.length - 2);
    for (let i = keep; i < ws.length && ws[i] === prev[i]; i++) keep = i + 1;
    return ws.slice(0, keep).join(' ');
  }

  private wallAt(clock: number): number {
    for (let i = this.wall.length - 1; i >= 0; i--) if (this.wall[i][0] <= clock) return this.wall[i][1];
    return this.wall[0]?.[1] ?? Date.now();
  }

  private onCommit(c: Commit): void {
    const t = this.transcriber;
    const t1 = this.finalTimes?.t1 ?? t.lastSpeechClock;
    const t0 = Math.min(t1, this.lastCommitT1 ?? this.finalTimes?.t0 ?? t.utteranceStart ?? t1);
    this.lastCommitT1 = t1;
    const seq = this.deps.nextSeq();
    const talk = this.deps.getTalk();
    const lag = Math.max(0, (Date.now() - this.wallAt(t1)) / 1000);
    const src = talk?.lang ?? '';
    const r = (x: number) => Math.round((x - this.talkOffset) * 100) / 100;
    this.deps.bus.publish({ type: 'segment', seq, src, text: c.text, t0: r(t0), t1: r(t1), kind: c.kind, lag: Math.round(lag * 100) / 100 });
    if (c.kind !== 'speech') {
      this.deps.bus.publish({ type: 'tr', seq, tr: Object.fromEntries(this.stage.targetLangs.map((l) => [l, c.text])), ms: 0 });
      return;
    }
    this.translator.translate(c.text, talk?.lang).then(
      (res) => {
        console.log(`[${this.label}] #${seq} mt ${res.ms} ms · ${c.text.slice(0, 60)}`);
        this.deps.bus.publish({ type: 'tr', seq, tr: res.tr, ms: res.ms });
      },
      (err) => console.log(`[${this.label}] translate crashed: ${(err as Error).message}`),
    );
  }
}
