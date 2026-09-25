// Load test for the README: boots the server in fake mode, opens N SSE connections to one stage and
// reports how many receive every segment, the delivery spread and the server's memory.
// Usage: npm run load [-- --clients=2000 --seconds=30]
import { execFileSync, spawn } from 'node:child_process';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const opt = (n: string, d: number) => Number(process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=')[1] ?? d);
const CLIENTS = opt('clients', 2000);
const SECONDS = opt('seconds', 30);
const PORT = 18300;
const STAGE = 'auditorium';

const server = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], {
  env: { ...process.env, FAKE_BACKEND: '1', PORT: String(PORT), DATA_DIR: path.join(os.tmpdir(), `ems-load-${Date.now()}`), GEMINI_API_KEY: '' },
  stdio: ['ignore', 'ignore', 'inherit'],
});

function rssMb(pid: number): number {
  try {
    if (process.platform === 'win32') {
      const line = execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8' });
      const kb = Number(line.split('","')[4]?.replace(/[^\d]/g, ''));
      return Math.round(kb / 1024);
    }
    return Math.round(Number(execFileSync('ps', ['-o', 'rss=', '-p', String(pid)], { encoding: 'utf8' })) / 1024);
  } catch {
    return NaN;
  }
}

async function up(): Promise<void> {
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`http://127.0.0.1:${PORT}/api/health`)).ok) return; } catch { /* booting */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('server did not start');
}

await up();
const baseRss = rssMb(server.pid!);
const agent = new http.Agent({ keepAlive: false, maxSockets: Infinity });
const received = new Map<number, number[]>();   // seq → arrival times (ms) across clients
let connected = 0;
let failed = 0;

for (let i = 0; i < CLIENTS; i++) {
  const req = http.get({ host: '127.0.0.1', port: PORT, path: `/api/stages/${STAGE}/stream`, agent }, (res) => {
    connected++;
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
          const seq = Number(m[1]);
          if (!received.has(seq)) received.set(seq, []);
          received.get(seq)!.push(Date.now());
        }
      }
    });
  });
  req.on('error', () => failed++);
  if (i % 200 === 199) await new Promise((r) => setTimeout(r, 50));
}

await new Promise((r) => setTimeout(r, SECONDS * 1000));
const rss = rssMb(server.pid!);
const full = [...received.entries()].filter(([, t]) => t.length === connected);
const spreads = full.map(([, t]) => Math.max(...t) - Math.min(...t)).sort((a, b) => a - b);
console.log(`clients: ${connected} connected, ${failed} failed`);
console.log(`segments seen: ${received.size}, delivered to every client: ${full.length}`);
console.log(`fan-out spread (first → last client) p50 ${spreads[Math.floor(spreads.length / 2)] ?? '?'} ms · max ${spreads.at(-1) ?? '?'} ms`);
console.log(`server RSS: ${baseRss} MB idle → ${rss} MB with ${connected} viewers`);
server.kill();
process.exit(0);
