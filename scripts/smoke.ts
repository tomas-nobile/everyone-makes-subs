// Boots the server with FAKE_BACKEND=1, connects to a stage's SSE stream and checks that
// `segment` and `tr` events arrive within 15 s. Exit code 0 = ok.
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const PORT = 18080;
const STAGE = 'auditorium';
const TIMEOUT_MS = 15_000;

const child = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], {
  env: { ...process.env, FAKE_BACKEND: '1', PORT: String(PORT), DATA_DIR: path.join(os.tmpdir(), 'ems-smoke'), GEMINI_API_KEY: '' },
  stdio: ['ignore', 'inherit', 'inherit'],
});

function finish(ok: boolean, msg: string): never {
  console.log(ok ? `smoke: OK · ${msg}` : `smoke: FAIL · ${msg}`);
  child.kill();
  process.exit(ok ? 0 : 1);
}

setTimeout(() => finish(false, `no segment+tr within ${TIMEOUT_MS / 1000}s`), TIMEOUT_MS);
child.on('exit', (code) => finish(false, `server exited with code ${code}`));

async function waitForHealth(): Promise<void> {
  for (;;) {
    try {
      const res = await fetch(`http://localhost:${PORT}/api/health`);
      if (res.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
}

await waitForHealth();
const res = await fetch(`http://localhost:${PORT}/api/stages/${STAGE}/stream`);
if (!res.ok || !res.body) finish(false, `stream returned ${res.status}`);

const seen = new Set<string>();
const decoder = new TextDecoder();
let buf = '';
for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
  buf += decoder.decode(chunk, { stream: true });
  let i;
  while ((i = buf.indexOf('\n\n')) >= 0) {
    const block = buf.slice(0, i);
    buf = buf.slice(i + 2);
    const data = block.split('\n').find((l) => l.startsWith('data: '));
    if (!data) continue;
    const ev = JSON.parse(data.slice(6)) as { type: string };
    seen.add(ev.type);
    if (seen.has('segment') && seen.has('tr')) finish(true, `events seen: ${[...seen].join(', ')}`);
  }
}
finish(false, 'stream closed');
