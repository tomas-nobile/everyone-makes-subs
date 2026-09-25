// F03.1 spike: streams a file (or URL) into Gemini Live transcription in real time and logs every
// raw server message with a timestamp, to answer the 3 questions in docs/decisions.md (LIVE-API:).
// Usage: GEMINI_API_KEY=… npx tsx server/scripts/spike-live.ts [samples/es.mp3|url] [--lang=es] [--end-at=20]
//   --end-at=N: sends audioStreamEnd at N s of audio, waits 3 s, then keeps sending (question 3).
import { Modality } from '@google/genai';
import type { SourceSpec } from '../../shared/contract.js';
import { AudioSource } from '../src/audio/sources.js';
import { loadConfig } from '../src/config.js';
import { genai } from '../src/gemini.js';

try { process.loadEnvFile(); } catch { /* no .env */ }
const cfg = loadConfig();
const arg = process.argv[2] ?? 'samples/es.mp3';
const lang = process.argv.find((a) => a.startsWith('--lang='))?.split('=')[1];
const endAt = Number(process.argv.find((a) => a.startsWith('--end-at='))?.split('=')[1] ?? 0);
const spec: SourceSpec = /^https?:\/\//.test(arg) ? { kind: 'url', url: arg } : { kind: 'file', path: arg };

const t0 = Date.now();
const ts = () => ((Date.now() - t0) / 1000).toFixed(2).padStart(7);
const src = new AudioSource(spec, 'spike', cfg.dataDir);

console.log(`[spike] model ${cfg.transcribeModel} · source ${arg}`);
const session = await genai(cfg.geminiApiKey).live.connect({
  model: cfg.transcribeModel,
  config: {
    responseModalities: [Modality.TEXT],
    inputAudioTranscription: { languageCodes: lang ? [lang] : [], mode: 'VERBATIM' as never },
  },
  callbacks: {
    onopen: () => console.log(`${ts()} OPEN`),
    onmessage: (m) => console.log(`${ts()} clock ${src.clock.toFixed(2)} MSG ${JSON.stringify(m)}`),
    onerror: (e) => console.log(`${ts()} ERROR ${(e as ErrorEvent).message ?? e}`),
    onclose: (e) => { console.log(`${ts()} CLOSE ${(e as CloseEvent).code} ${(e as CloseEvent).reason}`); process.exit(0); },
  },
});

let paused = false;
let ended = false;
src.on('chunk', (chunk: Buffer) => {
  if (endAt && !ended && src.clock >= endAt) {
    ended = true;
    paused = true;
    console.log(`${ts()} >>> audioStreamEnd at clock ${src.clock.toFixed(2)}`);
    session.sendRealtimeInput({ audioStreamEnd: true });
    setTimeout(() => { paused = false; console.log(`${ts()} >>> resuming audio`); }, 3000);
  }
  if (paused) return;
  session.sendRealtimeInput({ audio: { data: chunk.toString('base64'), mimeType: 'audio/pcm;rate=16000' } });
});
src.on('end', () => {
  console.log(`${ts()} source ended, audioStreamEnd`);
  session.sendRealtimeInput({ audioStreamEnd: true });
  setTimeout(() => { session.close(); process.exit(0); }, 8000);
});
src.start();
