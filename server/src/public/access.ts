import { execFile, spawn, type ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { TailscaleStatus } from '../../../shared/contract.js';
import { saveConfig, type Config } from '../config.js';

// Public access (docs/architecture.md → "Wizard step 3" and "Public access"):
// lan | tailscale (Funnel) | cloudflare (named tunnel) | url. Every QR and link uses publicUrl().

const run = promisify(execFile);
export const inDocker = fs.existsSync('/.dockerenv');

export function lanUrl(port: number): string {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.')) return `http://${a.address}:${port}`;
    }
  }
  return `http://localhost:${port}`;
}

export function publicUrl(cfg: Config): string {
  return (cfg.publicMode !== 'lan' && cfg.publicUrl ? cfg.publicUrl : lanUrl(cfg.port)).replace(/\/+$/, '');
}

/** Requests <url>/api/health?nonce=… and checks the server echoes the nonce (proves it is us). */
export async function nonceTest(url: string): Promise<{ ok: boolean; message?: string }> {
  const nonce = crypto.randomBytes(8).toString('hex');
  try {
    const res = await fetch(`${url.replace(/\/+$/, '')}/api/health?nonce=${nonce}`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return { ok: false, message: `The address answered with an error (${res.status}).` };
    const body = (await res.json()) as { nonce?: string };
    return body.nonce === nonce ? { ok: true } : { ok: false, message: 'Something answered at that address, but it is not this computer.' };
  } catch (err) {
    return { ok: false, message: `The address does not respond from outside (${(err as Error).name === 'TimeoutError' ? 'timeout' : (err as Error).message}).` };
  }
}

/** Reachability badge: checks the public URL every 60 s (null in lan mode or before the first check). */
export class PublicWatch {
  reachable: boolean | null = null;
  addressChangedAt = 0;
  private lastUrl = '';
  private timer?: NodeJS.Timeout;

  constructor(private cfg: Config) {}

  start(): void {
    this.lastUrl = publicUrl(this.cfg);
    const check = async () => {
      const url = publicUrl(this.cfg);
      if (url !== this.lastUrl) { this.lastUrl = url; this.addressChangedAt = Date.now(); }
      if (this.cfg.publicMode === 'lan' || !this.cfg.publicUrl) { this.reachable = null; return; }
      this.reachable = (await nonceTest(url)).ok;
    };
    void check();
    this.timer = setInterval(check, 60_000);
    this.timer.unref?.();
  }

  get addressChanged(): boolean {
    return Date.now() - this.addressChangedAt < 10 * 60_000;
  }

  stop(): void {
    clearInterval(this.timer);
  }
}

// ── Tailscale (F11.3) ──

function tailscaleCandidates(): string[] {
  if (process.platform === 'darwin') return ['tailscale', '/Applications/Tailscale.app/Contents/MacOS/Tailscale', '/usr/local/bin/tailscale', '/opt/homebrew/bin/tailscale'];
  if (process.platform === 'win32') return ['tailscale', 'C:\\Program Files\\Tailscale\\tailscale.exe', 'C:\\Program Files (x86)\\Tailscale\\tailscale.exe'];
  return ['tailscale', '/usr/bin/tailscale', '/usr/local/bin/tailscale'];
}

async function findTailscale(): Promise<string | null> {
  for (const c of tailscaleCandidates()) {
    if (c.includes('/') || c.includes('\\')) { if (fs.existsSync(c)) return c; continue; }
    try { await run(c, ['version'], { timeout: 5000 }); return c; } catch { /* not on PATH */ }
  }
  return null;
}

const CONSENT = /https:\/\/login\.tailscale\.com\/[^\s"']+/;

export async function tailscaleStatus(port: number): Promise<TailscaleStatus> {
  const bin = await findTailscale();
  const base: TailscaleStatus = { installed: !!bin, running: false, funnel: false, dnsName: null, url: null };
  if (!bin) return base;
  try {
    const { stdout } = await run(bin, ['status', '--json'], { timeout: 8000 });
    const st = JSON.parse(stdout) as { BackendState?: string; Self?: { DNSName?: string } };
    base.running = st.BackendState === 'Running';
    base.dnsName = st.Self?.DNSName?.replace(/\.$/, '') || null;
    base.url = base.dnsName ? `https://${base.dnsName}` : null;
  } catch (err) {
    base.message = `tailscale status failed: ${(err as Error).message.split('\n')[0]}`;
    return base;
  }
  if (base.running) {
    try {
      const { stdout } = await run(bin, ['funnel', 'status', '--json'], { timeout: 8000 });
      base.funnel = new RegExp(`:${port}\\b|127\\.0\\.0\\.1:${port}|localhost:${port}`).test(stdout) && /AllowFunnel/.test(stdout);
    } catch { /* older CLI: funnel unknown */ }
  }
  return base;
}

export async function tailscaleUp(port: number): Promise<TailscaleStatus> {
  const bin = await findTailscale();
  if (!bin) return tailscaleStatus(port);
  // `tailscale up` prints a login URL and waits; the UI polls status every 2 s.
  const p = spawn(bin, ['up'], { stdio: ['ignore', 'pipe', 'pipe'], detached: false });
  let out = '';
  const grab = (d: Buffer) => { out += d.toString(); };
  p.stdout.on('data', grab);
  p.stderr.on('data', grab);
  await new Promise((r) => setTimeout(r, 3000));
  const st = await tailscaleStatus(port);
  const m = CONSENT.exec(out);
  if (m && !st.running) st.consentUrl = m[0];
  return st;
}

export async function tailscaleFunnel(port: number): Promise<TailscaleStatus> {
  const bin = await findTailscale();
  if (!bin) return tailscaleStatus(port);
  let out = '';
  try {
    const r = await run(bin, ['funnel', '--bg', String(port)], { timeout: 20_000 });
    out = r.stdout + r.stderr;
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message: string };
    out = `${e.stdout ?? ''}${e.stderr ?? ''}${e.message}`;
  }
  const st = await tailscaleStatus(port);
  const m = CONSENT.exec(out);
  if (m) { st.consentUrl = m[0]; st.message = 'Click Enable and come back'; }
  else if (!st.funnel && out.trim()) st.message = out.trim().split('\n').slice(-2).join(' ');
  if (st.url && (st.funnel || /available on the internet|Funnel started|https:\/\//.test(out))) st.funnel = true;
  return st;
}

// ── Cloudflare named tunnel (F11.4) ──

let cloudflared: ChildProcess | undefined;

async function findCloudflared(dataDir: string): Promise<string> {
  try { await run('cloudflared', ['--version'], { timeout: 5000 }); return 'cloudflared'; } catch { /* not on PATH */ }
  const local = path.join(dataDir, 'bin', process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared');
  if (fs.existsSync(local)) return local;
  const asset = process.platform === 'win32' ? 'cloudflared-windows-amd64.exe'
    : process.platform === 'linux' ? (process.arch === 'arm64' ? 'cloudflared-linux-arm64' : 'cloudflared-linux-amd64') : null;
  if (!asset) throw new Error('Install cloudflared (brew install cloudflared) and try again');
  console.log(`[cloudflared] downloading ${asset}`);
  const res = await fetch(`https://github.com/cloudflare/cloudflared/releases/latest/download/${asset}`);
  if (!res.ok) throw new Error(`cloudflared download failed (${res.status})`);
  fs.mkdirSync(path.dirname(local), { recursive: true });
  fs.writeFileSync(local, Buffer.from(await res.arrayBuffer()), { mode: 0o755 });
  return local;
}

export async function startCloudflared(cfg: Config, token: string): Promise<void> {
  const bin = await findCloudflared(cfg.dataDir);
  cloudflared?.kill();
  cloudflared = spawn(bin, ['tunnel', '--no-autoupdate', 'run', '--token', token], { stdio: ['ignore', 'ignore', 'pipe'] });
  cloudflared.stderr?.on('data', (d: Buffer) => {
    const line = d.toString().trim();
    if (/ERR|error/i.test(line)) console.log(`[cloudflared] ${line.split('\n')[0].replace(token, '***')}`);
  });
  cloudflared.on('exit', (code) => console.log(`[cloudflared] exited (${code})`));
  saveConfig(cfg, { cloudflareToken: token });
}

export function stopCloudflared(): void {
  cloudflared?.kill();
  cloudflared = undefined;
}
