// Runs the real pipeline over audio files and reports whether it meets the acceptance criteria.
//   F03.2: interims and finals with consistent t0/t1        F04.3: translation p50 < 1.5 s
//   F01.3: --write regenerates samples/*.transcript.json from the real audio
//
// Usage:
//   npm run samples   (= --sample=es --sample=en --sample=mixed --write: 3 stages in parallel)
//   npx tsx server/scripts/transcribe-file.ts <file|url> --lang=es --title="…" [--speaker=…] [--seconds=60]
//   Flags: --glossary (generate the talk vocabulary first) · --no-translate · --write[=path]
import fs from 'node:fs';
import type { TalkInput } from '../../shared/contract.js';
import { emptyGlossary } from '../../shared/contract.js';
import { generateGlossary } from '../src/ai/auxModel.js';
import { loadConfig } from '../src/config.js';
import { pct, runFile } from '../src/stage/runFile.js';

try { process.loadEnvFile(); } catch { /* no .env */ }
const cfg = loadConfig();
if (!cfg.geminiApiKey) {
  console.log('No Gemini key: put GEMINI_API_KEY in .env or save it from /setup.');
  process.exit(2);
}

// Metadata of the sample cuts (samples/README.md).
const SAMPLES: Record<string, TalkInput & { file: string }> = {
  es: {
    file: 'samples/es.mp3', lang: 'es', title: 'Una guía de navegación: rendimiento en Kubernetes', speaker: 'Almudena Vivanco',
    abstract: 'Rendimiento en Kubernetes: requests y limits, CPU throttling, autoscaling (HPA, VPA), observabilidad con Prometheus y Grafana.',
  },
  en: {
    file: 'samples/en.mp3', lang: 'en', title: 'Model Context Protocol in Plain English', speaker: 'Nate Barbettini',
    abstract: 'What MCP is: clients, servers, tools and resources, how LLM apps like Claude connect to APIs, authorization with OAuth.',
  },
  // 30 s of es.mp3 + 30 s of en.mp3: no declared language, detected per sentence
  mixed: {
    file: 'samples/mixed.mp3', title: 'Panel: Kubernetes y MCP', speaker: 'Almudena Vivanco, Nate Barbettini',
    abstract: 'Rendimiento en Kubernetes / Model Context Protocol: clients, servers, tools.',
  },
};

const args = process.argv.slice(2);
const flag = (name: string) => args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
const value = (name: string) => flag(name)?.split('=').slice(1).join('=');
const seconds = Number(value('seconds') ?? 0);
const translate = !flag('no-translate');
const write = flag('write');

const jobs: Array<TalkInput & { file: string; key: string }> = [];
for (const a of args.filter((x) => x.startsWith('--sample='))) {
  const k = a.split('=')[1];
  if (!SAMPLES[k]) { console.log(`Unknown sample "${k}" (use ${Object.keys(SAMPLES).join(', ')})`); process.exit(2); }
  jobs.push({ ...SAMPLES[k], key: k });
}
const positional = args.find((a) => !a.startsWith('--'));
if (positional) jobs.push({ file: positional, key: 'file', lang: value('lang'), title: value('title') ?? positional, speaker: value('speaker') });
if (!jobs.length) { console.log('Nothing to run: pass a file or --sample=es'); process.exit(2); }

const results = await Promise.all(jobs.map(async (job) => {
  const glossary = flag('glossary') || job.key !== 'file' ? await generateGlossary(cfg, job) : emptyGlossary();
  if (glossary.asrVocabulary.length) console.log(`[${job.key}] vocabulary: ${glossary.asrVocabulary.slice(0, 20).join(', ')}${glossary.asrVocabulary.length > 20 ? '…' : ''}`);
  const langs = translate ? cfg.targetLangs : [job.lang ?? 'es'];
  const r = await runFile({ cfg, file: job.file, label: job.key, seconds, targetLangs: langs, talk: { title: job.title, speaker: job.speaker, lang: job.lang, glossary } });
  return { job, r, glossary };
}));

let ok = true;
for (const { job, r, glossary } of results) {
  const speech = r.segments.filter((s) => s.kind === 'speech');
  let monotonic = true;
  for (let i = 0; i < r.segments.length; i++) {
    const s = r.segments[i];
    if (!(s.t0 <= s.t1) || (i > 0 && s.t0 + 0.05 < r.segments[i - 1].t0)) monotonic = false;
  }
  const nulls = speech.filter((s) => Object.values(s.tr).some((t) => t === null)).length;
  const mt50 = pct(r.mtMs, 0.5);
  const hits = glossary.asrVocabulary.map((term) => [term, speech.filter((s) => s.text.toLowerCase().includes(term.toLowerCase())).length] as const).filter(([, n]) => n > 0);
  const f032 = r.interims > 0 && speech.length > 0 && monotonic;
  const f043 = !translate || (r.mtMs.length > 0 && mt50 < 1500 && nulls === 0);
  ok &&= f032 && f043;
  console.log(`\n=== ${job.key} · ${job.file}`);
  console.log(`interims ${r.interims} · segments ${r.segments.length} (${speech.length} speech) · audio sent ${r.sentSec.toFixed(1)} s · rotations ${r.rotations} · errors ${r.errors}`);
  console.log(`t0/t1 consistent and increasing: ${monotonic ? 'yes' : 'NO'}`);
  console.log(`delay original (lag) p50 ${pct(r.lagSec, 0.5).toFixed(2)} s · p95 ${pct(r.lagSec, 0.95).toFixed(2)} s`);
  if (translate) console.log(`translation p50 ${mt50} ms · p95 ${pct(r.mtMs, 0.95)} ms · failed segments ${nulls}`);
  if (hits.length) console.log(`vocabulary hits: ${hits.map(([t, n]) => `${t} ✓ ${n}`).join(' · ')}`);
  console.log(`F03.2 ${f032 ? 'PASS' : 'FAIL'} · F04.3 ${translate ? (f043 ? 'PASS' : 'FAIL') : 'skipped'}`);

  if (write) {
    const out = write.includes('=') ? write.split('=')[1] : job.file.replace(/\.[a-z0-9]+$/i, '.transcript.json');
    const lastT = r.events.at(-1)?.t ?? 0;
    fs.writeFileSync(out, JSON.stringify({ lang: job.lang ?? '', title: job.title, speaker: job.speaker, durationSec: Math.ceil(lastT + 3), events: r.events }, null, 1));
    console.log(`wrote ${out} (${r.events.length} events)`);
  }
}
process.exit(ok ? 0 : 1);
