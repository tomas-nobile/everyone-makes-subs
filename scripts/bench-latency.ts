// F17.1: end-to-end latency benchmark. Boots the real server with BENCH=1, creates one file-source
// stage with a talk, connects one SSE client and times every phrase at four points:
//   heard (first interim reaching the phrase's last word) → `segment` published → `tr.es` published → received.
// Two honest latencies, never averaged together:
//   pause → caption  (what the attendee feels): only for utterances closed by a pause; end of speech =
//                    the audio clock of the last speech chunk before the silence, mapped to wall time.
//   heard → caption  (our own pipeline delay): for every phrase.
// Plus time to first caption from stage start, phrases/min and the delivery column (publish → receive,
// same machine; doubles as the F17.6 check). Writes bench/latency-<timestamp>.json.
// Usage: npm run bench:latency [-- --file=samples/en.mp3 --runs=3 --lang=en --seconds=110 --fake --baseline=bench/latency-x.json]
//   --fake: FAKE_BACKEND replay (no key): only delivery and time-to-first-caption are meaningful.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { SegmentEvent, StageEvent, TrEvent } from '../shared/contract.js';

try { process.loadEnvFile(); } catch { /* no .env */ }
const opt = (n: string, d: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=') ?? d;
const FILE = path.resolve(opt('file', 'samples/en.mp3'));
const RUNS = Number(opt('runs', '3'));
const LANG = opt('lang', 'en');
const SECONDS = Number(opt('seconds', '110'));
const FAKE = process.argv.includes('--fake');
const BASELINE = opt('baseline', '');
const PORT = 18500;
const B = `http://127.0.0.1:${PORT}`;
const IDLE_END_MS = 12_000;

interface Phrase { run: number; seq: number; text: string; t0: number; t1: number; at?: number; heardAt?: number; endAt?: number; recvAt: number; trAt?: number; trRecvAt?: number; es?: string | null }
interface RunDetail { startAt: number; ttfcMs: number | null; phrases: number; audioSec: number; text: string }

const server = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], {
  env: {
    ...process.env, BENCH: '1', PORT: String(PORT), DATA_DIR: path.join(os.tmpdir(), `ems-bench-${Date.now()}`), ADMIN_PASSWORD: '', DEMO: '0', DEMO_STAGES: '1',
    ...(FAKE ? { FAKE_BACKEND: '1', GEMINI_API_KEY: '' } : {}),
  },
  stdio: ['ignore', process.argv.includes('--verbose') ? 'inherit' : 'ignore', 'inherit'],
});
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function api<T>(method: string, p: string, body?: unknown): Promise<T> {
  const res = await fetch(`${B}${p}`, { method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
  if (!res.ok) throw new Error(`${method} ${p} → ${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

const phrases: Phrase[] = [];
const runs: RunDetail[] = [];
try {
  for (let i = 0; ; i++) {
    try { if ((await fetch(`${B}/api/health`)).ok) break; } catch { /* booting */ }
    if (i > 150) throw new Error('server did not start');
    await sleep(200);
  }
  const stage = await api<{ id: string }>('POST', '/api/stages', { name: 'Bench', source: { kind: 'file', path: FILE, loop: false }, targetLangs: ['es', 'en', 'pt'] });
  await api('POST', `/api/stages/${stage.id}/talk`, { title: opt('title', path.basename(FILE)), speaker: opt('speaker', ''), abstract: opt('abstract', ''), lang: LANG });
  console.log(`[bench] ${FAKE ? 'FAKE_BACKEND replay' : 'real pipeline'} · ${path.relative('.', FILE)} · ${RUNS} run(s) · ${LANG} → es`);

  for (let run = 1; run <= RUNS; run++) {
    const startAt = Date.now();
    await api('POST', `/api/stages/${stage.id}/start`);
    const res = await fetch(`${B}/api/stages/${stage.id}/stream`);
    if (!res.ok || !res.body) throw new Error(`stream → ${res.status}`);
    const reader = (res.body as unknown as AsyncIterable<Uint8Array>)[Symbol.asyncIterator]();
    const decoder = new TextDecoder();
    const mine = new Map<number, Phrase>();
    let buf = '';
    let lastSegAt = 0;
    let first: number | null = null;
    const deadline = startAt + SECONDS * 1000 + (FAKE ? 0 : 60_000);   // the replay loops forever; a real file ends
    const stopAt = () => (lastSegAt ? Math.min(deadline, Math.max(lastSegAt + IDLE_END_MS, startAt + SECONDS * 1000)) : deadline);
    for (;;) {
      const timeout = stopAt() - Date.now();
      if (timeout <= 0) break;
      const next = await Promise.race([reader.next(), sleep(Math.min(timeout, 1000)).then(() => null)]);
      if (next === null) continue;
      if (next.done) break;
      buf += decoder.decode(next.value, { stream: true });
      let k: number;
      while ((k = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, k);
        buf = buf.slice(k + 2);
        const data = block.split('\n').find((l) => l.startsWith('data: '));
        if (!data) continue;
        const now = Date.now();
        const ev = JSON.parse(data.slice(6)) as StageEvent;
        if (ev.type === 'hello') { for (const s of ev.recent ?? []) mine.delete(s.seq); continue; }   // replayed history: not timed
        if (ev.type === 'segment') {
          const s = ev as SegmentEvent;
          if (s.kind !== 'speech') continue;
          lastSegAt = now;
          first ??= now;
          const p: Phrase = { run, seq: s.seq, text: s.text, t0: s.t0, t1: s.t1, at: s.at, heardAt: s.heardAt, endAt: s.endAt, recvAt: now };
          mine.set(s.seq, p);
          phrases.push(p);
          process.stdout.write(`\r[bench] run ${run}: ${mine.size} phrases, ${((now - startAt) / 1000).toFixed(0)} s   `);
        } else if (ev.type === 'tr') {
          const t = ev as TrEvent;
          const p = mine.get(t.seq);
          if (p && 'es' in t.tr && p.trRecvAt === undefined) { p.trAt = t.at; p.trRecvAt = now; p.es = t.tr.es; }
        }
      }
    }
    await api('POST', `/api/stages/${stage.id}/stop`);
    const list = [...mine.values()];
    const audioSec = list.length ? Math.max(...list.map((p) => p.t1)) - Math.min(...list.map((p) => p.t0)) : 0;
    runs.push({ startAt, ttfcMs: first ? first - startAt : null, phrases: list.length, audioSec, text: list.map((p) => p.text).join(' ') });
    console.log(`\n[bench] run ${run}: ${list.length} phrases over ${audioSec.toFixed(0)} s of audio · first caption after ${first ? ((first - startAt) / 1000).toFixed(1) : '?'} s`);
    await sleep(1500);
  }
} finally {
  server.kill();
  await sleep(300);
}

// ── report ──
const pct = (xs: number[], p: number) => { if (!xs.length) return NaN; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };
const col = (name: string, xs: number[]) => ({ name, p50: pct(xs, 0.5), p95: pct(xs, 0.95), max: xs.length ? Math.max(...xs) : NaN, n: xs.length });
const d = (a: number | undefined, b: number | undefined) => (a !== undefined && b !== undefined ? [a - b] : []);
const columns = [
  col('pause → original', phrases.flatMap((p) => d(p.recvAt, p.endAt))),
  col('pause → Spanish', phrases.flatMap((p) => d(p.trRecvAt, p.endAt))),
  col('heard → original', phrases.flatMap((p) => d(p.recvAt, p.heardAt))),
  col('heard → Spanish', phrases.flatMap((p) => d(p.trRecvAt, p.heardAt))),
  col('translation (es)', phrases.flatMap((p) => d(p.trAt, p.at))),
  col('delivery', phrases.flatMap((p) => [...d(p.recvAt, p.at), ...d(p.trRecvAt, p.trAt)])),
];
const audioMin = runs.reduce((n, r) => n + r.audioSec, 0) / 60;
const phrasesPerMin = audioMin ? phrases.length / audioMin : NaN;
const ttfc = runs.map((r) => (r.ttfcMs === null ? '?' : (r.ttfcMs / 1000).toFixed(1)));
const untranslated = phrases.filter((p) => p.trRecvAt === undefined || p.es === null).length;
const fmt = (ms: number) => (Number.isNaN(ms) ? '   —  ' : ms >= 1000 || ms < 0 ? `${(ms / 1000).toFixed(2)} s`.padStart(7) : `${Math.round(ms)} ms`.padStart(7));
console.log(`\n${''.padEnd(20)}${'p50'.padStart(7)}${'p95'.padStart(8)}${'max'.padStart(8)}     n`);
for (const c of columns) console.log(`${c.name.padEnd(20)}${fmt(c.p50)} ${fmt(c.p95)} ${fmt(c.max)}  ${String(c.n).padStart(4)}`);
console.log(`runs ${runs.length} · phrases ${phrases.length} · ${phrasesPerMin.toFixed(1)} phrases/min · time to first caption ${ttfc.join(' / ')} s · untranslated ${untranslated}`);

// word diff against a baseline run (F17.2: no duplicated or lost words)
let diff: { added: number; removed: number; words: number; baselineWords: number } | undefined;
if (BASELINE) {
  const base = JSON.parse(fs.readFileSync(BASELINE, 'utf8')) as { runs: RunDetail[] };
  const norm = (t: string) => t.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}\s]/gu, '').split(/\s+/).filter(Boolean);
  const a = norm(base.runs[0]?.text ?? '');
  const b = norm(runs[0]?.text ?? '');
  const lcs = lcsLength(a, b);
  diff = { added: b.length - lcs, removed: a.length - lcs, words: b.length, baselineWords: a.length };
  console.log(`vs ${path.basename(BASELINE)} (run 1 each): ${diff.words} words vs ${diff.baselineWords} · ${diff.added} added · ${diff.removed} missing (LCS)`);
}

fs.mkdirSync('bench', { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const out = path.join('bench', `latency-${stamp}.json`);
fs.writeFileSync(out, JSON.stringify({
  at: new Date().toISOString(), file: path.relative('.', FILE), lang: LANG, runCount: runs.length, fake: FAKE, machine: `${os.cpus()[0]?.model.trim()} · ${os.platform()} · node ${process.version}`,
  env: Object.fromEntries(Object.entries(process.env).filter(([k]) => /^(VAD_|FORCE_COMMIT|SENTENCE_MIN|COMMA_MIN|MAX_PHRASE|TRANSLATE_|TRANSCRIBE_MODEL|SESSION_)/.test(k))),
  summary: { columns, phrasesPerMin, timeToFirstCaptionMs: runs.map((r) => r.ttfcMs), untranslated, diff },
  runs: runs.map((r) => ({ ...r, text: r.text })), phrases,
}, null, 1));
console.log(`wrote ${out}`);
process.exit(0);

function lcsLength(a: string[], b: string[]): number {
  let prev = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    const cur = new Array<number>(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j++) cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    prev = cur;
  }
  return prev[b.length];
}
