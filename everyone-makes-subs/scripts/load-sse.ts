// Load test for the README (F19.2): boots the server in fake mode with N rooms, opens M SSE viewers
// spread across them and reports, per room, how many viewers got every phrase and the delivery spread
// (first → last viewer), plus the server's CPU % and RSS while it runs (from /api/dev/stats).
// Usage: npm run load [-- --stages=8 --clients=2000 --seconds=30]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const opt = (n: string, d: number) => Number(process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=')[1] ?? d);
const STAGES = opt('stages', 1);
const CLIENTS = opt('clients', 2000);
const SECONDS = opt('seconds', 30);
const PORT = 18300;
const B = `http://127.0.0.1:${PORT}`;

const server = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], {
  env: { ...process.env, FAKE_BACKEND: '1', DEMO_STAGES: String(STAGES), PORT: String(PORT), DATA_DIR: path.join(os.tmpdir(), `ems-load-${Date.now()}`), GEMINI_API_KEY: '' },
  stdio: ['ignore', 'ignore', 'inherit'],
});

interface Stats { cpuPct: number; rssMb: number; stages: number; viewers: number }
const stats = () => fetch(`${B}/api/dev/stats`).then((r) => r.json() as Promise<Stats>);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function up(): Promise<void> {
  for (let i = 0; i < 150; i++) {
    try { if ((await fetch(`${B}/api/health`)).ok) return; } catch { /* booting */ }
    await sleep(200);
  }
  throw new Error('server did not start');
}

await up();
const stageIds = ((await (await fetch(`${B}/api/event`)).json()) as { stages: Array<{ id: string }> }).stages.map((s) => s.id).slice(0, STAGES);
if (stageIds.length < STAGES) throw new Error(`only ${stageIds.length} rooms came up`);
await sleep(2000);
const idle = await stats();
const agent = new http.Agent({ keepAlive: false, maxSockets: Infinity });
const received = new Map<string, Map<number, number[]>>(stageIds.map((id) => [id, new Map()]));   // stage → seq → arrival times
const connected = new Map<string, number>(stageIds.map((id) => [id, 0]));
let failed = 0;

console.log(`[load] ${STAGES} room(s) × ${Math.round(CLIENTS / STAGES)} viewers = ${CLIENTS} SSE connections for ${SECONDS} s`);
for (let i = 0; i < CLIENTS; i++) {
  const stage = stageIds[i % stageIds.length];
  const req = http.get({ host: '127.0.0.1', port: PORT, path: `/api/stages/${stage}/stream`, agent }, (res) => {
    connected.set(stage, (connected.get(stage) ?? 0) + 1);
    let buf = '';
    res.setEncoding('utf8');
    res.on('data', (d: string) => {
      buf += d;
      let k;
      while ((k = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, k);
        buf = buf.slice(k + 2);
        const m = /"type":"segment","seq":(\d+)/.exec(block);
        if (m) {
          const seqs = received.get(stage)!;
          const seq = Number(m[1]);
          if (!seqs.has(seq)) seqs.set(seq, []);
          seqs.get(seq)!.push(Date.now());
        }
      }
    });
  });
  req.on('error', () => failed++);
  if (i % 200 === 199) await sleep(50);
}

// sample CPU/RSS every 2 s while the viewers read
const samples: Stats[] = [];
const t0 = Date.now();
while (Date.now() - t0 < SECONDS * 1000) {
  await sleep(2000);
  try { samples.push(await stats()); } catch { /* busy */ }
}
const totalConnected = [...connected.values()].reduce((a, b) => a + b, 0);
const pct = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * p))] ?? NaN; };
const rows: string[] = [];
const allSpreads: number[] = [];
for (const id of stageIds) {
  const n = connected.get(id) ?? 0;
  const full = [...received.get(id)!.entries()].filter(([, t]) => t.length === n);
  const spreads = full.map(([, t]) => Math.max(...t) - Math.min(...t));
  allSpreads.push(...spreads);
  rows.push(`  ${id.padEnd(12)} ${String(n).padStart(5)} viewers · ${received.get(id)!.size} phrases seen, ${full.length} delivered to every viewer · spread p50 ${pct(spreads, 0.5)} ms · p95 ${pct(spreads, 0.95)} ms · max ${spreads.length ? Math.max(...spreads) : '?'} ms`);
}
const cpu = samples.map((s) => s.cpuPct);
const rss = samples.map((s) => s.rssMb);
console.log(`clients: ${totalConnected} connected, ${failed} failed`);
console.log(rows.join('\n'));
console.log(`fan-out spread, all rooms: p50 ${pct(allSpreads, 0.5)} ms · p95 ${pct(allSpreads, 0.95)} ms · max ${allSpreads.length ? Math.max(...allSpreads) : '?'} ms`);
console.log(`server CPU: avg ${cpu.length ? (cpu.reduce((a, b) => a + b, 0) / cpu.length).toFixed(0) : '?'} % · max ${cpu.length ? Math.max(...cpu) : '?'} % of one core`);
console.log(`server RSS: ${idle.rssMb} MB idle (${STAGES} rooms, 0 viewers) → ${rss.length ? Math.max(...rss) : '?'} MB with ${totalConnected} viewers`);
console.log(`machine: ${os.cpus()[0]?.model.trim()} · ${os.cpus().length} threads · ${Math.round(os.totalmem() / 1073741824)} GB · ${os.platform()} · node ${process.version}`);
const cpuAvg = cpu.length ? Math.round(cpu.reduce((a, b) => a + b, 0) / cpu.length) : NaN;
console.log(`\n| ${STAGES} | ${totalConnected} | ${pct(allSpreads, 0.5)} ms | ${pct(allSpreads, 0.95)} ms | ${cpuAvg} % (max ${cpu.length ? Math.max(...cpu) : '?'} %) | ${idle.rssMb} → ${rss.length ? Math.max(...rss) : '?'} MB |`);
// the demo video (F16.6) reads the latest of these; docs/scale.md is written from the same run
fs.mkdirSync('bench', { recursive: true });
const out = path.join('bench', `scale-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`);
fs.writeFileSync(out, JSON.stringify({
  at: new Date().toISOString(), stages: STAGES, viewers: totalConnected, failed, seconds: SECONDS,
  spreadP50Ms: pct(allSpreads, 0.5), spreadP95Ms: pct(allSpreads, 0.95), spreadMaxMs: allSpreads.length ? Math.max(...allSpreads) : null,
  cpuAvgPct: cpuAvg, cpuMaxPct: cpu.length ? Math.max(...cpu) : null, rssIdleMb: idle.rssMb, rssMb: rss.length ? Math.max(...rss) : null,
  machine: `${os.cpus()[0]?.model.trim()} · ${os.cpus().length} threads · ${Math.round(os.totalmem() / 1073741824)} GB · ${os.platform()} · node ${process.version}`,
  perStage: rows,
}, null, 1));
console.log(`wrote ${out}`);
server.kill();
await sleep(300);
process.exit(0);
