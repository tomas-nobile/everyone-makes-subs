// F03.1 spike: streams a file (or URL) into Gemini Live transcription in real time, logs every raw
// server message with a timestamp and, at the end, answers the 3 questions of docs/architecture.md:
//   1. are interims cumulative or deltas?  2. how often do finals arrive with no pause?
//   3. does the session accept audio after audioStreamEnd?
// Usage: npx tsx server/scripts/spike-live.ts [samples/es.mp3|url] [--lang=es] [--end-at=20] [--seconds=60] [--quiet] [--log]
//   --end-at=N: sends audioStreamEnd at N s of audio, pauses 3 s, then resumes (question 3; default 30)
//   --log: appends the answers to docs/decisions.md as LIVE-API: lines
import fs from 'node:fs';
import { Modality, type LiveServerMessage } from '@google/genai';
import type { SourceSpec } from '../../shared/contract.js';
import { AudioSource } from '../src/audio/sources.js';
import { loadConfig } from '../src/config.js';
import { genai } from '../src/gemini.js';

try { process.loadEnvFile(); } catch { /* no .env */ }
const cfg = loadConfig();
if (!cfg.geminiApiKey) { console.log('No Gemini key: put GEMINI_API_KEY in .env or save it from /setup.'); process.exit(2); }
const args = process.argv.slice(2);
const arg = args.find((a) => !a.startsWith('--')) ?? 'samples/es.mp3';
const opt = (n: string) => args.find((a) => a.startsWith(`--${n}=`))?.split('=')[1];
const lang = opt('lang');
const endAt = Number(opt('end-at') ?? 30);
const maxSec = Number(opt('seconds') ?? 0);
const quiet = args.includes('--quiet');
const spec: SourceSpec = /^https?:\/\//.test(arg) ? { kind: 'url', url: arg } : { kind: 'file', path: arg };

const t0 = Date.now();
const now = () => (Date.now() - t0) / 1000;
const ts = () => now().toFixed(2).padStart(7);
const src = new AudioSource(spec, 'spike', cfg.dataDir);

// observations
const interims: Array<{ t: number; text: string }> = [];
const finals: Array<{ t: number; text: string }> = [];
const fields = new Set<string>();
let endSentAt = 0;
let resumedAt = 0;
let afterResume = 0;
let closed = '';

function record(m: LiveServerMessage): void {
  const collect = (o: unknown, prefix: string) => {
    if (!o || typeof o !== 'object') return;
    for (const [k, v] of Object.entries(o)) {
      fields.add(prefix + k);
      if (v && typeof v === 'object' && !Array.isArray(v) && prefix.split('.').length < 3) collect(v, `${prefix}${k}.`);
    }
  };
  collect(m, '');
  const sc = m.serverContent;
  const interim = sc?.interimInputTranscription?.text ?? (sc?.inputTranscription && !sc.inputTranscription.finished ? sc.inputTranscription.text : undefined);
  if (interim) interims.push({ t: now(), text: interim });
  if (sc?.inputTranscription?.finished || sc?.turnComplete) finals.push({ t: now(), text: sc?.inputTranscription?.text ?? '' });
  if (resumedAt && (interim || sc?.inputTranscription?.text)) afterResume++;
}

console.log(`[spike] model ${cfg.transcribeModel} · source ${arg}`);
const session = await genai(cfg.geminiApiKey).live.connect({
  model: cfg.transcribeModel,
  config: {
    responseModalities: [Modality.TEXT],
    inputAudioTranscription: { languageCodes: lang ? [lang] : [], mode: 'VERBATIM' as never },
  },
  callbacks: {
    onopen: () => console.log(`${ts()} OPEN`),
    onmessage: (m) => {
      record(m);
      if (!quiet) console.log(`${ts()} clock ${src.clock.toFixed(2)} MSG ${JSON.stringify(m)}`);
    },
    onerror: (e) => console.log(`${ts()} ERROR ${(e as ErrorEvent).message ?? e}`),
    onclose: (e) => { closed = `${(e as CloseEvent).code} ${(e as CloseEvent).reason}`; console.log(`${ts()} CLOSE ${closed}`); report(); },
  },
});

let paused = false;
src.on('chunk', (chunk: Buffer) => {
  if (endAt && !endSentAt && src.clock >= endAt) {
    endSentAt = now();
    paused = true;
    console.log(`${ts()} >>> audioStreamEnd at clock ${src.clock.toFixed(2)}`);
    session.sendRealtimeInput({ audioStreamEnd: true });
    setTimeout(() => { paused = false; resumedAt = now(); console.log(`${ts()} >>> resuming audio`); }, 3000);
  }
  if (maxSec && src.clock >= maxSec) return finish();
  if (paused) return;
  session.sendRealtimeInput({ audio: { data: chunk.toString('base64'), mimeType: 'audio/pcm;rate=16000' } });
});
src.on('end', finish);
src.start();

let finishing = false;
function finish(): void {
  if (finishing) return;
  finishing = true;
  src.stop();
  console.log(`${ts()} end of audio, audioStreamEnd`);
  session.sendRealtimeInput({ audioStreamEnd: true });
  setTimeout(() => { try { session.close(); } catch { /* closed */ } report(); }, 8000);
}

let reported = false;
function report(): void {
  if (reported) return;
  reported = true;
  // 1. cumulative vs deltas: within an utterance, does each interim extend the previous one?
  let extend = 0;
  let other = 0;
  for (let i = 1; i < interims.length; i++) {
    const a = interims[i - 1].text.trim().toLowerCase();
    const b = interims[i].text.trim().toLowerCase();
    if (!a || !b) continue;
    if (b.startsWith(a.slice(0, Math.max(1, Math.floor(a.length * 0.6))))) extend++; else other++;
  }
  const q1 = interims.length < 2 ? 'not enough interims to tell'
    : extend > other * 2 ? `CUMULATIVE (${extend} of ${extend + other} interims extend the previous one)`
      : other > extend * 2 ? `DELTAS (${other} of ${extend + other} interims do not repeat the previous text)` : `MIXED (${extend} extend, ${other} do not)`;
  // 2. finals cadence
  const gaps = finals.slice(1).map((f, i) => f.t - finals[i].t).filter((g) => g > 0.2);
  const avg = gaps.length ? gaps.reduce((x, y) => x + y, 0) / gaps.length : NaN;
  const q2 = finals.length < 2 ? `${finals.length} final(s) only` : `${finals.length} finals, one every ${avg.toFixed(1)} s on average (max gap ${Math.max(...gaps).toFixed(1)} s)`;
  // 3. audio after audioStreamEnd
  const q3 = !endSentAt ? 'not tested (audio shorter than --end-at)'
    : closed && !resumedAt ? `NO: the session closed after audioStreamEnd (${closed})`
      : afterResume > 0 ? `YES: ${afterResume} transcription message(s) after resuming` : 'NO transcription after resuming (session open but silent)';
  const tfields = [...fields].filter((f) => /transcription|goAway|turnComplete/i.test(f)).sort();
  console.log('\n=== F03.1 answers');
  console.log(`model: ${cfg.transcribeModel}`);
  console.log(`1. interims: ${q1}`);
  console.log(`2. finals: ${q2}`);
  console.log(`3. audio after audioStreamEnd: ${q3}`);
  console.log(`fields seen: ${tfields.join(', ') || '(none)'}`);
  if (args.includes('--log')) {
    const day = new Date().toISOString().slice(0, 10);
    const lines = [
      `- ${day} · LIVE-API: model \`${cfg.transcribeModel}\`; fields seen: ${tfields.map((f) => `\`${f}\``).join(', ')}.`,
      `- ${day} · LIVE-API: (1) interims are ${q1}. (2) ${q2}. (3) audio after \`audioStreamEnd\`: ${q3}.`,
    ].join('\n') + '\n';
    const p = 'docs/decisions.md';
    const s = fs.readFileSync(p, 'utf8');
    const marker = '`LIVE-API:` (findings from F03.1).\n\n';
    const i = s.indexOf(marker);
    fs.writeFileSync(p, i >= 0 ? s.slice(0, i + marker.length) + lines + s.slice(i + marker.length) : s + lines);
    console.log('logged in docs/decisions.md');
  }
  process.exit(interims.length || finals.length ? 0 : 1);
}
