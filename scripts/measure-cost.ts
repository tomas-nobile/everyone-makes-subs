// F19.3: measured cost. Runs K rooms on the real pipeline (DEMO rooms, samples looping) for M minutes,
// reads the audio minutes sent and the translation tokens (usageMetadata) from the dashboard metrics and
// prints US$ per room-hour at the list prices in docs/pricing.json. Writes bench/cost-<timestamp>.json.
// Usage: npm run cost [-- --rooms=2 --minutes=10]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AdminMetrics } from '../shared/contract.js';

try { process.loadEnvFile(); } catch { /* no .env */ }
if (!process.env.GEMINI_API_KEY) { console.log('No Gemini key in .env: the measurement needs the real pipeline.'); process.exit(2); }
const opt = (n: string, d: number) => Number(process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=')[1] ?? d);
const ROOMS = opt('rooms', 2);
const MINUTES = opt('minutes', 10);
const PORT = 18600;
const B = `http://127.0.0.1:${PORT}`;
const pricing = JSON.parse(fs.readFileSync('docs/pricing.json', 'utf8')) as { listPrices: Record<string, { usdPerMin?: number; usdPerMTokensIn?: number; usdPerMTokensOut?: number }> };
const ASR = pricing.listPrices['gemini-3.5-transcribe-live'].usdPerMin!;
const IN = pricing.listPrices['gemini-3.5-flash-lite'].usdPerMTokensIn!;
const OUT = pricing.listPrices['gemini-3.5-flash-lite'].usdPerMTokensOut!;

const server = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], {
  env: { ...process.env, DEMO: '1', DEMO_STAGES: String(ROOMS), PORT: String(PORT), DATA_DIR: path.join(os.tmpdir(), `ems-cost-${Date.now()}`), ADMIN_PASSWORD: '' },
  stdio: ['ignore', 'ignore', 'inherit'],
});
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function metrics(): Promise<AdminMetrics> {
  const res = await fetch(`${B}/api/admin/metrics`);
  const reader = (res.body as unknown as AsyncIterable<Uint8Array>)[Symbol.asyncIterator]();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.next();
    if (done) throw new Error('metrics stream closed');
    buf += new TextDecoder().decode(value);
    const k = buf.indexOf('\n\n');
    if (k >= 0) { const line = buf.slice(0, k).split('\n').find((l) => l.startsWith('data: '))!; void reader.return?.(); return JSON.parse(line.slice(6)); }
  }
}
try {
  for (let i = 0; ; i++) {
    try { if ((await fetch(`${B}/api/health`)).ok) break; } catch { /* booting */ }
    if (i > 150) throw new Error('server did not start');
    await sleep(200);
  }
  console.log(`[cost] ${ROOMS} room(s) live on the real pipeline for ${MINUTES} min…`);
  const started = Date.now();
  for (let m = 1; m <= MINUTES; m++) {
    await sleep(60_000);
    const snap = await metrics();
    const audio = snap.stages.reduce((n, s) => n + s.audioMin, 0);
    const tin = snap.stages.reduce((n, s) => n + s.tokens.in, 0);
    const tout = snap.stages.reduce((n, s) => n + s.tokens.out, 0);
    console.log(`[cost] ${m}/${MINUTES} min · audio sent ${audio.toFixed(1)} min · tokens ${tin} in / ${tout} out · 429s ${snap.stages.reduce((n, s) => n + s.http429, 0)} · live ${snap.stagesLive}/${ROOMS}`);
  }
  const snap = await metrics();
  const hours = (Date.now() - started) / 3_600_000;
  const roomHours = hours * ROOMS;
  const audioMin = snap.stages.reduce((n, s) => n + s.audioMin, 0);
  const tin = snap.stages.reduce((n, s) => n + s.tokens.in, 0);
  const tout = snap.stages.reduce((n, s) => n + s.tokens.out, 0);
  const langs = snap.stages[0]?.talk?.lang ? [...new Set(snap.stages.flatMap((s) => (s.talk?.lang ? ['es', 'en', 'pt'].filter((l) => l !== s.talk!.lang) : [])))] : ['es', 'pt'];
  const perRoomHour = { audioMin: audioMin / roomHours, tokensIn: tin / roomHours, tokensOut: tout / roomHours };
  const cost = (outShare: number) => perRoomHour.audioMin * ASR + (perRoomHour.tokensIn / 1e6) * IN + ((perRoomHour.tokensOut * outShare) / 1e6) * OUT;
  const nTargets = Math.max(1, langs.length);
  const row = {
    at: new Date().toISOString(), rooms: ROOMS, minutes: Math.round(hours * 60 * 10) / 10, targetLangs: langs, http429: snap.stages.reduce((n, s) => n + s.http429, 0),
    perRoomHour: { ...perRoomHour, usdEsOnly: Math.round(cost(1 / nTargets) * 1000) / 1000, usdAllTargets: Math.round(cost(1) * 1000) / 1000 },
    prices: { asrUsdPerMin: ASR, inUsdPerMTokens: IN, outUsdPerMTokens: OUT },
    note: `output tokens are shared by ${nTargets} target language(s) in one call; the es-only figure assumes 1/${nTargets} of them`,
  };
  fs.mkdirSync('bench', { recursive: true });
  const file = path.join('bench', `cost-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`);
  fs.writeFileSync(file, JSON.stringify(row, null, 1));
  console.log(`\nper room-hour: ${perRoomHour.audioMin.toFixed(1)} audio min · ${Math.round(perRoomHour.tokensIn)} tokens in · ${Math.round(perRoomHour.tokensOut)} out`);
  console.log(`US$ ${row.perRoomHour.usdEsOnly.toFixed(3)} / room-hour (es only) · US$ ${row.perRoomHour.usdAllTargets.toFixed(3)} (${langs.join(' + ')})`);
  console.log(`| ${row.at.slice(0, 16)} | ${ROOMS} | ${row.minutes} | ${perRoomHour.audioMin.toFixed(1)} | ${Math.round(perRoomHour.tokensIn).toLocaleString()} / ${Math.round(perRoomHour.tokensOut).toLocaleString()} | ${row.perRoomHour.usdEsOnly.toFixed(2)} | ${row.perRoomHour.usdAllTargets.toFixed(2)} |`);
  console.log(`wrote ${file}`);
} finally {
  server.kill();
  await sleep(300);
}
process.exit(0);
