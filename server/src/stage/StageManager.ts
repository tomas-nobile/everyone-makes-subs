import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  emptyGlossary,
  type AdminMetrics, type AdminStage, type AgendaProposal, type Alert, type Glossary, type Segment, type Stage,
  type StageInput, type StageMetrics, type StageState, type StageSummary, type Summary, type Talk, type TalkInput,
} from '../../../shared/contract.js';
import { FakeBackend, loadTranscript } from '../asr/FakeBackend.js';
import { fakeGlossary, generateGlossary, summarize } from '../ai/auxModel.js';
import { EventBus } from '../bus/EventBus.js';
import type { Config } from '../config.js';
import { StageStats } from '../metrics/Metrics.js';
import { Store } from '../store/Store.js';
import { StageWorker, type Worker } from './StageWorker.js';

interface StageRecord { id: string; name: string; source: Stage['source']; targetLangs: string[]; stationKey: string; running: boolean; talkId?: string }

export interface StageRuntime {
  stage: Stage;
  bus: EventBus;
  stationKey: string;
  running: boolean;
  worker?: Worker;
  stats: StageStats;
  seq: number;
  pending: Map<number, Segment>;
  forced?: StageState;
  lastTalkId?: string;
  noSignalSince: number | null;
  snoozedUntil: number;
  summary: { at: number | null; bullets: Record<string, string[]>; seq: number; lastRun: number };
}

const SUMMARY_EVERY_MS = 60_000;
const AUTO_SWITCH_AFTER_MS = 5 * 60_000;

/** Creates/starts/stops stage workers, persists stages.json + talks.json, runs the schedule. */
export class StageManager {
  private stages = new Map<string, StageRuntime>();
  private talks: Talk[] = [];
  private ticker?: NodeJS.Timeout;
  agendaProgress: { done: number; total: number } | null = null;
  readonly store: Store;

  constructor(private cfg: Config) {
    this.store = new Store(cfg.dataDir);
  }

  // ── persistence ──

  private file(name: string): string {
    return path.join(this.cfg.dataDir, name);
  }

  load(): void {
    let recs: StageRecord[] = [];
    try { recs = JSON.parse(fs.readFileSync(this.file('stages.json'), 'utf8')); } catch { /* first run */ }
    try { this.talks = JSON.parse(fs.readFileSync(this.file('talks.json'), 'utf8')); } catch { this.talks = []; }
    for (const r of recs) {
      const rt = this.makeRuntime({ id: r.id, name: r.name, source: r.source, targetLangs: r.targetLangs, state: 'idle', talkId: r.talkId, viewers: 0 }, r.stationKey);
      if (r.running) this.start(r.id);
    }
    this.ticker = setInterval(() => this.tick(), 1000);
    this.ticker.unref?.();
    if (recs.length) console.log(`[stages] restored ${recs.length} stage(s), ${this.talks.length} talk(s)`);
  }

  save(): void {
    const recs: StageRecord[] = this.list().map((rt) => ({
      id: rt.stage.id, name: rt.stage.name, source: rt.stage.source, targetLangs: rt.stage.targetLangs,
      stationKey: rt.stationKey, running: rt.running, talkId: rt.stage.talkId,
    }));
    writeAtomic(this.file('stages.json'), JSON.stringify(recs, null, 2));
    writeAtomic(this.file('talks.json'), JSON.stringify(this.talks, null, 2));
  }

  // ── stages ──

  list(): StageRuntime[] {
    return [...this.stages.values()];
  }

  get(id: string): StageRuntime | undefined {
    return this.stages.get(id);
  }

  private makeRuntime(stage: Stage, stationKey: string): StageRuntime {
    const rt: StageRuntime = {
      stage, bus: new EventBus(), stationKey, running: false, stats: new StageStats(), seq: 0, pending: new Map(),
      noSignalSince: null, snoozedUntil: 0, summary: { at: null, bullets: {}, seq: 0, lastRun: 0 },
    };
    for (const t of this.talks.filter((x) => x.stageId === stage.id)) {
      for (const s of this.store.list(stage.id, t.id)) rt.seq = Math.max(rt.seq, s.seq);
    }
    rt.bus.lastSeq = rt.seq;
    const cur = this.talkOf(rt);
    rt.stats.resetVocab(cur?.glossary.asrVocabulary ?? [], cur ? this.store.list(stage.id, cur.id) : []);
    rt.bus.subscribe(({ ev }) => {
      if (ev.type === 'segment') {
        const seg: Segment = { seq: ev.seq, talkId: rt.stage.talkId ?? 'no-talk', src: ev.src, text: ev.text, tr: {}, t0: ev.t0, t1: ev.t1, kind: ev.kind, ms: { asr: Math.round((ev.lag ?? 0) * 1000) }, ...(ev.u ? { u: ev.u } : {}) };
        rt.pending.set(ev.seq, seg);
        rt.stats.onSegment(ev.seq, ev.text, ev.lag);
        setTimeout(() => this.persist(rt, ev.seq), 20_000).unref?.();
      } else if (ev.type === 'tr') {
        const seg = rt.pending.get(ev.seq);
        if (seg) { seg.tr = ev.tr; seg.ms.mt = ev.ms; this.persist(rt, ev.seq); }
        rt.stats.onTr(ev.seq, ev.ms);
      } else if (ev.type === 'level') rt.stats.level = ev.v;
      else if (ev.type === 'live') rt.stats.liveLine = ev.text;
    });
    this.stages.set(stage.id, rt);
    return rt;
  }

  private persist(rt: StageRuntime, seq: number): void {
    const seg = rt.pending.get(seq);
    if (!seg) return;
    rt.pending.delete(seq);
    for (const l of rt.stage.targetLangs) if (!(l in seg.tr)) seg.tr[l] = null;
    this.store.append(rt.stage.id, seg);
  }

  create(input: StageInput): StageRuntime {
    const id = uniqueId(slug(input.name) || 'stage', (x) => this.stages.has(x));
    const rt = this.makeRuntime({
      id, name: input.name.trim(), source: input.source, targetLangs: input.targetLangs?.length ? input.targetLangs : this.cfg.targetLangs,
      state: 'idle', viewers: 0,
    }, crypto.randomBytes(9).toString('base64url'));
    this.save();
    console.log(`[${id}] created (${input.source.kind})`);
    return rt;
  }

  update(id: string, patch: Partial<StageInput>): StageRuntime | undefined {
    const rt = this.stages.get(id);
    if (!rt) return;
    const restart = rt.running && patch.source && JSON.stringify(patch.source) !== JSON.stringify(rt.stage.source);
    if (patch.name?.trim()) rt.stage.name = patch.name.trim();
    if (patch.source) rt.stage.source = patch.source;
    if (patch.targetLangs?.length) rt.stage.targetLangs = patch.targetLangs;
    this.save();
    if (restart) { this.stop(id); this.start(id); }
    return rt;
  }

  remove(id: string): boolean {
    const rt = this.stages.get(id);
    if (!rt) return false;
    rt.worker?.stop();
    this.stages.delete(id);
    this.talks = this.talks.filter((t) => t.stageId !== id);
    this.save();
    return true;
  }

  start(id: string): StageRuntime | undefined {
    const rt = this.stages.get(id);
    if (!rt) return;
    if (rt.running && rt.worker) return rt;
    rt.running = true;
    rt.stats = Object.assign(new StageStats(), { lastLine: rt.stats.lastLine });
    const cur = this.talkOf(rt);
    rt.stats.resetVocab(cur?.glossary.asrVocabulary ?? [], cur ? this.store.list(id, cur.id) : []);
    try {
      rt.worker = this.makeWorker(rt);
      rt.worker.start();
    } catch (err) {
      console.log(`[${id}] worker failed to start: ${(err as Error).message}`);
    }
    this.save();
    this.setState(rt, this.computeState(rt));
    return rt;
  }

  stop(id: string): StageRuntime | undefined {
    const rt = this.stages.get(id);
    if (!rt) return;
    rt.running = false;
    rt.worker?.stop();
    rt.worker = undefined;
    this.save();
    this.setState(rt, 'idle');
    return rt;
  }

  stopAll(): void {
    clearInterval(this.ticker);
    for (const rt of this.stages.values()) rt.worker?.stop();
  }

  ingest(id: string, key: string, data: Buffer): 'ok' | 'not_found' | 'bad_key' | 'not_station' {
    const rt = this.stages.get(id);
    if (!rt) return 'not_found';
    if (key !== rt.stationKey) return 'bad_key';
    if (rt.stage.source.kind !== 'station') return 'not_station';
    rt.worker?.ingest?.(data);
    return 'ok';
  }

  private makeWorker(rt: StageRuntime): Worker {
    const src = rt.stage.source;
    const deps = {
      cfg: this.cfg, bus: rt.bus,
      getTalk: () => this.talkOf(rt),
      nextSeq: () => ++rt.seq,
      onError: (status: number) => rt.stats.onError(status),
    };
    // Replay instead of real audio: FAKE_BACKEND=1, or a sample file with a transcript when its audio
    // is missing or there is no key yet (DEMO=1 must show captions before the wizard gets a key).
    let transcript: string | undefined;
    if (src.kind === 'file' && (!fs.existsSync(src.path) || !this.cfg.geminiApiKey)) {
      const t = src.path.replace(/\.[a-z0-9]+$/i, '.transcript.json');
      if (fs.existsSync(t)) transcript = t;
    }
    if (this.cfg.fakeBackend || transcript) {
      const samples = path.resolve(process.env.SAMPLES_DIR ?? 'samples');
      const file = transcript ?? path.join(samples, [...this.stages.keys()].indexOf(rt.stage.id) % 2 === 1 ? 'en.transcript.json' : 'es.transcript.json');
      return new FakeBackend(rt.stage.id, rt.bus, loadTranscript(file), deps.nextSeq);
    }
    return new StageWorker(rt.stage, deps);
  }

  // ── talks ──

  talkOf(rt: StageRuntime): Talk | null {
    return this.talks.find((t) => t.id === rt.stage.talkId && t.status === 'live') ?? null;
  }

  lastOf(rt: StageRuntime): Talk | null {
    return this.talks.find((t) => t.id === rt.lastTalkId) ?? null;
  }

  nextOf(rt: StageRuntime): Talk | null {
    const queue = this.talks.filter((t) => t.stageId === rt.stage.id && t.status === 'next');
    queue.sort((a, b) => (a.startsAt ?? '￿').localeCompare(b.startsAt ?? '￿'));
    return queue[0] ?? null;
  }

  talksOf(stageId: string): Talk[] {
    return this.talks.filter((t) => t.stageId === stageId);
  }

  getTalk(id: string): Talk | undefined {
    return this.talks.find((t) => t.id === id);
  }

  async addTalk(stageId: string, input: TalkInput, glossary?: Glossary): Promise<Talk | undefined> {
    const rt = this.stages.get(stageId);
    if (!rt) return;
    const talk: Talk = {
      id: uniqueId(`${stageId}-${slug(input.title).slice(0, 40) || 'talk'}`, (x) => this.talks.some((t) => t.id === x)),
      stageId, title: input.title.trim(), speaker: input.speaker?.trim() || undefined, abstract: input.abstract?.trim() || undefined,
      lang: input.lang || undefined, startsAt: input.startsAt, endsAt: input.endsAt,
      glossary: glossary ?? await generateGlossary(this.cfg, input), status: 'next',
    };
    this.talks.push(talk);
    if (input.queue) { this.save(); this.announce(rt); } else this.switchTo(rt, talk);
    console.log(`[${stageId}] talk "${talk.title}" (${talk.glossary.asrVocabulary.length} terms)${input.queue ? ' queued' : ' is now current'}`);
    return talk;
  }

  /** Makes `talk` current: closes the previous one and makes the ASR pick up the new vocabulary. */
  private switchTo(rt: StageRuntime, talk: Talk | null): void {
    const prev = this.talkOf(rt);
    if (prev && prev !== talk) { prev.status = 'done'; rt.lastTalkId = prev.id; }
    if (talk) talk.status = 'live';
    rt.stage.talkId = talk?.id;
    for (const seq of [...rt.pending.keys()]) this.persist(rt, seq);
    rt.worker?.markTalkStart();
    rt.worker?.requestRotation();
    rt.stats.resetVocab(talk?.glossary.asrVocabulary ?? [], talk ? this.store.list(rt.stage.id, talk.id) : []);
    rt.summary = { at: null, bullets: {}, seq: rt.seq, lastRun: 0 };
    rt.snoozedUntil = 0;
    this.save();
    this.announce(rt);
    console.log(`[${rt.stage.id}] talk → ${talk ? `"${talk.title}"` : '(none: break or end)'}`);
  }

  nextTalk(stageId: string): StageRuntime | undefined {
    const rt = this.stages.get(stageId);
    if (!rt) return;
    this.switchTo(rt, this.nextOf(rt));
    return rt;
  }

  updateGlossary(talkId: string, g: Glossary): Talk | undefined {
    const talk = this.getTalk(talkId);
    if (!talk) return;
    talk.glossary = { ...emptyGlossary(), ...g, asrVocabulary: (g.asrVocabulary ?? []).slice(0, 100) };
    this.save();
    const rt = this.stages.get(talk.stageId);
    if (rt && rt.stage.talkId === talk.id) {
      rt.worker?.requestRotation();
      rt.stats.resetVocab(talk.glossary.asrVocabulary, this.store.list(rt.stage.id, talk.id));
    }
    return talk;
  }

  deleteTalk(talkId: string): boolean {
    const talk = this.getTalk(talkId);
    if (!talk) return false;
    const rt = this.stages.get(talk.stageId);
    if (rt && rt.stage.talkId === talkId) this.switchTo(rt, null);
    this.talks = this.talks.filter((t) => t.id !== talkId);
    this.save();
    if (rt) this.announce(rt);
    return true;
  }

  /** F10.2: creates missing stages and the talks, generating glossaries 4 at a time. */
  async applyAgenda(p: AgendaProposal): Promise<{ stages: StageRuntime[]; talks: Talk[] }> {
    const byRoom = new Map<string, StageRuntime>();
    for (const room of [...new Set([...p.rooms, ...p.talks.map((t) => t.room)])]) {
      const existing = this.list().find((rt) => rt.stage.name.toLowerCase() === room.toLowerCase());
      byRoom.set(room, existing ?? this.create({ name: room, source: { kind: 'station' } }));
    }
    this.agendaProgress = { done: 0, total: p.talks.length };
    const out: Talk[] = [];
    let i = 0;
    const work = async () => {
      while (i < p.talks.length) {
        const a = p.talks[i++];
        const rt = byRoom.get(a.room)!;
        const input: TalkInput = { title: a.title, speaker: a.speaker, abstract: a.abstract, lang: a.lang, startsAt: toIso(a.start), endsAt: toIso(a.end), queue: true };
        const talk = await this.addTalk(rt.stage.id, input);
        if (talk) out.push(talk);
        this.agendaProgress = { done: this.agendaProgress!.done + 1, total: p.talks.length };
      }
    };
    await Promise.all([work(), work(), work(), work()]);
    setTimeout(() => { this.agendaProgress = null; }, 10_000).unref?.();
    return { stages: [...new Set(byRoom.values())], talks: out };
  }

  // ── views ──

  summaryOf(rt: StageRuntime): StageSummary {
    return { ...rt.stage, talk: this.talkOf(rt), next: this.nextOf(rt) };
  }

  adminView(rt: StageRuntime): AdminStage {
    return { ...this.summaryOf(rt), stationKey: rt.stationKey, talks: this.talksOf(rt.stage.id) };
  }

  recent(rt: StageRuntime, n = 10): Segment[] {
    const talk = this.talkOf(rt);
    const stored = talk ? this.store.list(rt.stage.id, talk.id) : [];
    return [...stored, ...rt.pending.values()].sort((a, b) => a.seq - b.seq).slice(-n);
  }

  history(rt: StageRuntime, before: number, talkId?: string): Segment[] {
    const id = talkId ?? rt.stage.talkId;
    if (!id) return [];
    return this.store.list(rt.stage.id, id).filter((s) => s.seq < before).slice(-50);
  }

  summary(rt: StageRuntime, lang: string): Summary {
    const s = rt.summary;
    return { lang, bullets: s.bullets[lang] ?? s.bullets[Object.keys(s.bullets)[0]] ?? [], at: s.at };
  }

  forceState(id: string, state: StageState | undefined): void {
    const rt = this.stages.get(id);
    if (!rt) return;
    rt.forced = state;
    this.setState(rt, this.computeState(rt));
  }

  snooze(alertId: string): void {
    const m = /^switch:(.+?):/.exec(alertId);
    const rt = m && this.stages.get(m[1]);
    if (rt) rt.snoozedUntil = Date.now() + AUTO_SWITCH_AFTER_MS;
  }

  // ── state, alerts, schedule, summary ──

  private computeState(rt: StageRuntime): StageState {
    if (!rt.running || !rt.worker) return 'idle';
    if (rt.forced) return rt.forced;
    const w = rt.worker;
    let s: StageState;
    if (w instanceof FakeBackend) s = w.fakeState === 'idle' ? 'connecting' : w.fakeState;
    else if (!this.cfg.geminiApiKey) s = 'error';
    else s = w.sourceState === 'live' ? (w.silentForMs > 20_000 ? 'paused' : 'live') : w.sourceState;
    const d = rt.stats.delay();
    if ((s === 'live' || s === 'paused') && (w.stats.backlogSec > 10 || rt.stats.errorsPerMin > 3 || (d?.p95Tr ?? 0) > 6)) s = 'degraded';
    return s;
  }

  private setState(rt: StageRuntime, state: StageState): void {
    if (rt.stage.state === state) return;
    rt.stage.state = state;
    this.announce(rt);
    console.log(`[${rt.stage.id}] state → ${state}`);
  }

  /** `state` event with the current talk and the next one (also after a talk change). */
  private announce(rt: StageRuntime): void {
    rt.bus.publish({ type: 'state', state: rt.stage.state, talk: this.talkOf(rt), next: this.nextOf(rt), last: this.lastOf(rt) });
  }

  private tick(): void {
    const now = Date.now();
    for (const rt of this.stages.values()) {
      this.setState(rt, this.computeState(rt));
      rt.noSignalSince = rt.stage.state === 'no_signal' ? (rt.noSignalSince ?? now) : null;
      // schedule: auto switch at +5 min past the next talk's start, at a silence longer than 3 s
      const next = this.nextOf(rt);
      const startsAt = next?.startsAt ? Date.parse(next.startsAt) : NaN;
      if (rt.running && next && startsAt + AUTO_SWITCH_AFTER_MS <= now && now >= rt.snoozedUntil && (rt.worker?.silentForMs ?? 0) > 3000) {
        console.log(`[${rt.stage.id}] schedule: switching to "${next.title}" on its own`);
        this.switchTo(rt, next);
      }
      // summary: every 60 s with new segments, only while someone is watching (it is a shared cache, never per request)
      if (rt.running && rt.stage.viewers > 0 && now - rt.summary.lastRun >= SUMMARY_EVERY_MS && rt.seq > rt.summary.seq) this.runSummary(rt);
    }
  }

  private runSummary(rt: StageRuntime): void {
    const talk = this.talkOf(rt);
    rt.summary.lastRun = Date.now();
    const segs = this.recent(rt, 400);
    const lastT1 = segs.at(-1)?.t1 ?? 0;
    const window = segs.filter((s) => s.t1 >= lastT1 - 300);
    if (!window.length) return;
    const seq = rt.seq;
    summarize(this.cfg, talk?.title ?? rt.stage.name, window, rt.stage.targetLangs).then(
      (bullets) => {
        rt.summary = { ...rt.summary, bullets, at: Date.now(), seq };
        console.log(`[${rt.stage.id}] summary generated (${window.length} segments)`);
      },
      (err) => console.log(`[${rt.stage.id}] summary failed: ${(err as Error).message}`),
    );
  }

  alerts(publicState: { reachable: boolean | null; addressChanged: boolean }): Alert[] {
    const out: Alert[] = [];
    const now = Date.now();
    for (const rt of this.stages.values()) {
      const { id, name } = rt.stage;
      const noAudio = rt.noSignalSince ? Math.round((now - rt.noSignalSince) / 1000) : 0;
      if (noAudio > 30) {
        const hint = rt.stage.source.kind === 'station' ? 'Is the room station open?' : 'Is the stream or file still playing?';
        out.push({ id: `no_audio:${id}`, kind: 'no_audio', stageId: id, message: `${name}: no audio for ${noAudio} s. ${hint}` });
      }
      const d = rt.stats.delay();
      if (rt.running && d && d.p95Tr > 6) out.push({ id: `delay:${id}`, kind: 'delay', stageId: id, message: `${name}: captions are running late (about ${Math.round(d.p95Tr)} s).` });
      const errs = rt.stats.errorsPerMin;
      if (errs > 3) out.push({ id: `errors:${id}`, kind: 'errors', stageId: id, message: `${name}: Gemini is failing (${errs} errors in the last minute). Captions may be delayed.` });
      const next = this.nextOf(rt);
      const startsAt = next?.startsAt ? Date.parse(next.startsAt) : NaN;
      if (next && startsAt <= now && now >= rt.snoozedUntil) {
        const hhmm = new Date(startsAt).toTimeString().slice(0, 5);
        out.push({ id: `switch:${id}:${next.id}`, kind: 'talk_switch', stageId: id, talk: next, message: `${name} · ${hhmm} · Move to the next talk?` });
      }
    }
    if (publicState.reachable === false) out.push({ id: 'public_down', kind: 'public_down', message: "Phones can't get in: the public address is not responding." });
    if (publicState.addressChanged) out.push({ id: 'address_changed', kind: 'address_changed', message: 'The address changed: reprint the QR codes.' });
    return out;
  }

  metrics(eventName: string, publicUrl: string, publicState: { reachable: boolean | null; addressChanged: boolean }): AdminMetrics {
    const stages: StageMetrics[] = this.list().map((rt) => {
      const w = rt.worker;
      const ws = w?.stats ?? { sentSec: 0, rotations: 0, maxGapMs: 0, reconnects: 0, backlogSec: 0 };
      return {
        id: rt.stage.id, name: rt.stage.name, state: rt.stage.state, level: rt.running ? rt.stats.level : 0,
        lastLine: rt.stats.lastLine, liveLine: rt.stats.liveLine, talk: this.talkOf(rt), next: this.nextOf(rt),
        viewers: rt.stage.viewers, delay: rt.stats.delay(), lag: Math.round(ws.backlogSec * 10) / 10,
        noAudioSec: rt.noSignalSince ? Math.round((Date.now() - rt.noSignalSince) / 1000) : 0,
        rotations: ws.rotations, maxGapMs: ws.maxGapMs, reconnects: ws.reconnects,
        errorsPerMin: rt.stats.errorsPerMin, http429: rt.stats.http429, audioMin: Math.round(ws.sentSec / 6) / 10,
        costPerHour: rt.running ? rt.stats.costPerHour(ws.sentSec) : 0,
        model: { transcribe: this.cfg.fakeBackend ? 'fake' : this.cfg.transcribeModel, translate: this.cfg.fakeBackend ? 'fake' : this.cfg.translateModel },
        vocab: rt.stats.vocabCounts(),
      };
    });
    return {
      at: Date.now(), eventName, publicUrl, reachable: publicState.reachable,
      totalViewers: stages.reduce((n, s) => n + s.viewers, 0),
      stagesLive: stages.filter((s) => s.state === 'live' || s.state === 'degraded').length,
      stages, alerts: this.alerts(publicState), agenda: this.agendaProgress,
    };
  }

  // ── demo ──

  /** DEMO=1 / FAKE_BACKEND=1 / "Try with sample data": Auditorium (es) and Room 2 (en) on the samples. */
  async createDemoStages(samplesDir: string): Promise<StageRuntime[]> {
    const demo = [
      { name: 'Auditorium', file: 'es', next: { title: 'WebAssembly fuera del navegador: lo que nadie te cuenta', speaker: 'Martín Ibarra', lang: 'es' } },
      { name: 'Room 2', file: 'en', next: { title: 'Rust para devs de Go', speaker: 'Sofía Paz', lang: 'es' } },
    ];
    const out: StageRuntime[] = [];
    for (const d of demo) {
      if (this.list().some((rt) => rt.stage.name === d.name)) continue;
      const transcript = loadTranscript(path.join(samplesDir, `${d.file}.transcript.json`));
      const rt = this.create({ name: d.name, source: { kind: 'file', path: path.join(samplesDir, `${d.file}.mp3`), loop: true } });
      const input: TalkInput = { title: transcript.title, speaker: transcript.speaker, lang: transcript.lang, abstract: transcript.events.filter((e) => e.type === 'final').map((e) => e.text).join(' ').slice(0, 600) };
      // with a key, Gemini builds the vocabulary (so the dashboard shows real hits); offline otherwise
      const real = this.cfg.geminiApiKey && !this.cfg.fakeBackend;
      await this.addTalk(rt.stage.id, input, real ? undefined : fakeGlossary(input));
      const at = new Date(Date.now() + 30 * 60_000);
      at.setMinutes(Math.ceil(at.getMinutes() / 15) * 15, 0, 0);
      await this.addTalk(rt.stage.id, { ...d.next, startsAt: at.toISOString(), queue: true }, fakeGlossary(d.next));
      this.start(rt.stage.id);
      out.push(rt);
    }
    return out;
  }
}

function slug(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function uniqueId(base: string, taken: (id: string) => boolean): string {
  let id = base;
  for (let i = 2; taken(id); i++) id = `${base}-${i}`;
  return id;
}

function toIso(t?: string): string | undefined {
  if (!t) return undefined;
  const m = /^(\d{1,2}):(\d{2})$/.exec(t.trim());
  if (!m) return Number.isNaN(Date.parse(t)) ? undefined : new Date(t).toISOString();
  const d = new Date();
  d.setHours(Number(m[1]), Number(m[2]), 0, 0);
  return d.toISOString();
}

function writeAtomic(file: string, data: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}
