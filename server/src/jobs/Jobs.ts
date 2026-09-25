// F18.1: video jobs. A job turns an uploaded video (or a YouTube link) into the same video with
// subtitles burned in, plus VTT/SRT — the `npm run clip` pipeline (runFile → export → ffmpeg
// `subtitles`) behind an API, one job at a time. Files live in <dataDir>/jobs/<id>/.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import ffmpegPath from 'ffmpeg-static';
import { emptyGlossary, type Job, type Segment } from '../../../shared/contract.js';
import { generateGlossary } from '../ai/auxModel.js';
import { loadTranscript } from '../asr/FakeBackend.js';
import { findYtDlp } from '../audio/ytdlp.js';
import type { Config } from '../config.js';
import { runFile } from '../stage/runFile.js';
import { toSrt, toVtt } from '../store/export.js';

// F18.3: burned-in style matching the room screen — white on a semi-transparent black box, 2 lines
// of ~42 characters (the exporter wraps at 42), Atkinson Hyperlegible with Segoe UI as the fallback.
export const BURN_STYLE = "FontName=Atkinson Hyperlegible,FontSize=22,PrimaryColour=&H00FFFFFF,BackColour=&H80000000,BorderStyle=4,Outline=0,Shadow=0,MarginV=36,Alignment=2";

export interface JobInput { lang?: string; srcLang?: string; title?: string; speaker?: string; abstract?: string }

const BURN_SHARE = 0.15;   // the burn is ~15% of the job's time; transcription the rest

export class Jobs {
  private jobs = new Map<string, Job>();
  private running: string | null = null;
  private dir: string;
  private samplesDir: string;

  constructor(private cfg: Config, samplesDir: string) {
    this.dir = path.join(cfg.dataDir, 'jobs');
    this.samplesDir = samplesDir;
  }

  /** After a restart a job that was running shows as `error` ("interrupted"); done ones stay. */
  load(): void {
    if (!fs.existsSync(this.dir)) return;
    for (const id of fs.readdirSync(this.dir)) {
      try {
        const job = JSON.parse(fs.readFileSync(path.join(this.dir, id, 'job.json'), 'utf8')) as Job;
        if (job.status !== 'done' && job.status !== 'error') { job.status = 'error'; job.message = 'Interrupted by a server restart'; job.etaSec = 0; }
        this.jobs.set(job.id, job);
        this.save(job);
      } catch { /* not a job folder */ }
    }
    if (this.jobs.size) console.log(`[jobs] restored ${this.jobs.size} job(s)`);
  }

  list(): Job[] {
    return [...this.jobs.values()].sort((a, b) => b.createdAt - a.createdAt);
  }

  get(id: string): Job | undefined {
    return this.jobs.get(id);
  }

  folder(id: string): string {
    return path.join(this.dir, id);
  }

  /** Path of an output file (`video.mp4`, `video.vtt`, `video.srt`) if the job produced it. */
  output(id: string, name: 'video.mp4' | 'video.vtt' | 'video.srt'): string | null {
    const job = this.jobs.get(id);
    if (!job || job.status !== 'done') return null;
    const p = path.join(this.folder(id), name);
    return fs.existsSync(p) ? p : null;
  }

  remove(id: string): boolean {
    const job = this.jobs.get(id);
    if (!job || this.running === id) return false;
    this.jobs.delete(id);
    fs.rmSync(this.folder(id), { recursive: true, force: true });
    return true;
  }

  createFromUpload(name: string, body: Buffer, input: JobInput): Job {
    const ext = (/\.([a-z0-9]{2,4})$/i.exec(name)?.[1] ?? 'mp4').toLowerCase();
    const job = this.make({ kind: 'file', name }, input);
    fs.writeFileSync(path.join(this.folder(job.id), `source.${ext}`), body);
    this.pump();
    return job;
  }

  createFromUrl(url: string, input: JobInput): Job {
    const job = this.make({ kind: 'url', url }, input);
    this.pump();
    return job;
  }

  private make(source: Job['source'], input: JobInput): Job {
    const id = `${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${crypto.randomBytes(4).toString('hex')}`;
    const job: Job = {
      id, status: 'queued', progress: 0, etaSec: 0, message: 'Waiting for its turn',
      title: input.title?.trim() || (source.kind === 'file' ? source.name.replace(/\.[a-z0-9]+$/i, '') : source.url),
      speaker: input.speaker?.trim() || undefined, abstract: input.abstract?.trim() || undefined,
      lang: input.lang || 'es', srcLang: input.srcLang || undefined, source, createdAt: Date.now(),
    };
    fs.mkdirSync(this.folder(id), { recursive: true });
    this.jobs.set(id, job);
    this.save(job);
    console.log(`[jobs] ${id} queued (${source.kind === 'file' ? source.name : source.url} → ${job.lang})`);
    return job;
  }

  private save(job: Job): void {
    fs.writeFileSync(path.join(this.folder(job.id), 'job.json'), JSON.stringify(job, null, 2));
  }

  private set(job: Job, patch: Partial<Job>): void {
    Object.assign(job, patch);
    this.save(job);
  }

  private pump(): void {
    if (this.running) return;
    const next = this.list().reverse().find((j) => j.status === 'queued');
    if (!next) return;
    this.running = next.id;
    this.run(next)
      .catch((err) => {
        console.log(`[jobs] ${next.id} failed: ${(err as Error).message}`);
        this.set(next, { status: 'error', message: (err as Error).message.slice(0, 200), etaSec: 0 });
      })
      .finally(() => { this.running = null; this.pump(); });
  }

  private async run(job: Job): Promise<void> {
    const dir = this.folder(job.id);
    const started = Date.now();
    this.set(job, { status: 'transcribing', progress: 0.01, message: job.source.kind === 'url' ? 'Downloading the video' : 'Reading the video' });

    // 1. the source video
    let source = fs.readdirSync(dir).find((f) => f.startsWith('source.'));
    if (job.source.kind === 'url') {
      const ytdlp = await findYtDlp(this.cfg.dataDir);
      await run(ytdlp, ['--no-warnings', '--no-playlist', '-f', 'b[height<=720][ext=mp4]/b[ext=mp4]/b', '--ffmpeg-location', path.dirname(ffmpegPath as unknown as string), '-o', 'source.%(ext)s', job.source.url], dir);
      source = fs.readdirSync(dir).find((f) => f.startsWith('source.'));
    }
    if (!source) throw new Error('No video to subtitle');
    const duration = await probeDuration(path.join(dir, source));
    const speed = this.cfg.fakeBackend || !this.cfg.geminiApiKey ? 1 : this.cfg.jobSpeed;
    this.set(job, { durationSec: duration, speed, message: 'Transcribing and translating' });

    // 2. subtitles from the real pipeline (or the replay in fake mode)
    const langs = [...new Set([...(job.srcLang ? [job.srcLang] : []), job.lang])];
    const transcribeSec = duration / speed;
    const progress = setInterval(() => {
      const p = Math.min(0.97, (Date.now() - started) / 1000 / transcribeSec) * (1 - BURN_SHARE);
      this.set(job, { progress: Math.max(job.progress, p), etaSec: Math.max(1, Math.round(transcribeSec - (Date.now() - started) / 1000 + duration * BURN_SHARE)) });
    }, 1000);
    let segments: Segment[];
    try {
      segments = await this.transcribe(job, path.join(dir, source), langs, speed);
    } finally {
      clearInterval(progress);
    }
    const lang = job.lang === job.srcLang ? undefined : job.lang;
    fs.writeFileSync(path.join(dir, 'video.vtt'), toVtt(segments, lang));
    fs.writeFileSync(path.join(dir, 'video.srt'), toSrt(segments, lang));
    this.set(job, { status: 'burning', progress: 1 - BURN_SHARE, segments: segments.length, message: 'Burning the subtitles into the video' });

    // 3. burn (run inside the job folder: the subtitles filter cannot take a Windows drive colon)
    await burn(source, 'video.vtt', 'video.mp4', dir, duration, (done) => this.set(job, { progress: 1 - BURN_SHARE + BURN_SHARE * done, etaSec: Math.max(0, Math.round((1 - done) * duration * BURN_SHARE)) }));
    this.set(job, { status: 'done', progress: 1, etaSec: 0, message: `Done in ${Math.round((Date.now() - started) / 1000)} s` });
    console.log(`[jobs] ${job.id} done: ${segments.length} segments, ${Math.round((Date.now() - started) / 1000)} s`);
  }

  private async transcribe(job: Job, file: string, langs: string[], speed: number): Promise<Segment[]> {
    if (this.cfg.fakeBackend || !this.cfg.geminiApiKey) return this.fakeSegments(job);
    const talkInput = { title: job.title, speaker: job.speaker, abstract: job.abstract, lang: job.srcLang };
    const glossary = await generateGlossary(this.cfg, talkInput);
    const r = await runFile({ cfg: this.cfg, file, label: `job-${job.id}`, targetLangs: langs, speed, talk: { ...talkInput, glossary }, onLine: () => {} });
    return r.segments;
  }

  /** Fake mode / no key: the sample transcript's phrases, spread over the video's duration, so F18.2 works offline. */
  private async fakeSegments(job: Job): Promise<Segment[]> {
    const sample = job.srcLang === 'es' ? 'es' : 'en';
    const t = loadTranscript(path.join(this.samplesDir, `${sample}.transcript.json`));
    const finals = t.events.filter((e) => e.type === 'final');
    const duration = job.durationSec ?? 60;
    const scale = duration / Math.max(1, finals.at(-1)?.t ?? duration);
    await new Promise((r) => setTimeout(r, Math.min(8000, duration * 100)));
    return finals.map((e, i) => ({
      seq: i + 1, talkId: 'fake', src: e.type === 'final' ? e.src : t.lang, text: e.text,
      tr: e.type === 'final' ? { ...e.tr, [job.lang]: e.tr[job.lang] ?? e.text } : {},
      t0: Math.round(e.type === 'final' ? e.t0 * scale * 100 : 0) / 100, t1: Math.round(e.type === 'final' ? e.t1 * scale * 100 : 0) / 100,
      kind: e.type === 'final' ? e.kind : 'speech', ms: { asr: 0 },
    }));
  }
}

function run(bin: string, argv: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, argv, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    p.stdout.on('data', (d: Buffer) => { out += d.toString(); });
    p.stderr.on('data', (d: Buffer) => { err += d.toString(); });
    p.on('error', reject);
    p.on('exit', (code) => (code === 0 ? resolve(out.trim()) : reject(new Error(`${path.basename(bin)} exited with ${code}: ${err.trim().split('\n').at(-1) ?? ''}`))));
  });
}

/** Duration in seconds from ffmpeg's banner (ffmpeg-static ships no ffprobe). */
export async function probeDuration(file: string): Promise<number> {
  const p = spawn(ffmpegPath as unknown as string, ['-hide_banner', '-i', file], { stdio: ['ignore', 'ignore', 'pipe'] });
  let err = '';
  p.stderr.on('data', (d: Buffer) => { err += d.toString(); });
  await new Promise((r) => p.on('exit', r));
  const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(err);
  if (!m) throw new Error('Could not read the video (is it a video file?)');
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

/** ffmpeg `subtitles` burn with the room-screen style; `onProgress` gets 0..1 from ffmpeg's own progress. */
export function burn(input: string, vtt: string, output: string, cwd: string, durationSec: number, onProgress?: (done: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = ['-hide_banner', '-loglevel', 'error', '-nostats', '-progress', 'pipe:1', '-y', '-i', input,
      '-vf', `subtitles=${vtt}:force_style='${BURN_STYLE}'`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-c:a', 'copy', '-movflags', '+faststart', output];
    const p = spawn(ffmpegPath as unknown as string, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    p.stdout.on('data', (d: Buffer) => {
      const m = /out_time_us=(\d+)/g;
      let last: RegExpExecArray | null = null;
      for (let x; (x = m.exec(d.toString())); ) last = x;
      if (last && durationSec > 0) onProgress?.(Math.min(1, Number(last[1]) / 1e6 / durationSec));
    });
    p.stderr.on('data', (d: Buffer) => { err += d.toString(); });
    p.on('error', reject);
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited with ${code}: ${err.trim().split('\n').at(-1) ?? ''}`))));
  });
}

export { emptyGlossary };
