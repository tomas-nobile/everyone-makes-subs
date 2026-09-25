// F16: the pitch video, one chapter per judging criterion — Deploy → Quality → Latency → Scalability →
// Innovation → Price — each an explanation panel over footage of the running app, English talk →
// Spanish captions throughout. Boots the server with DEMO=1 and DEMO_STAGES rooms, records the views
// with Electron, renders the panels as PNGs with alpha and composes everything with ffmpeg.
// Every number on a panel comes from a measured run (bench/latency-*.json, bench/scale-*.json,
// demo/ab/ab.json, demo/deploy.json) or from docs/pricing.json — nothing is typed in here.
// Usage: npm run demo-video [-- --replay --out=demo/demo.mp4 --clip=demo/clip.es.mp4 --stages=8 --warm=40]
//   --replay: the rooms replay recorded runs (samples/*.transcript.json, demo/clip.transcript.json)
//             instead of running the live pipeline — no quota while recording.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ffmpegPath from 'ffmpeg-static';

const opt = (n: string, d: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=') ?? d;
const OUT = path.resolve(opt('out', 'demo/demo.mp4'));
const CLIP = path.resolve(opt('clip', 'demo/clip.es.mp4'));           // burned-in Spanish subtitles (F16.2)
const RAW_CLIP = CLIP.replace(/\.[a-z]{2}\.mp4$/, '.mp4');            // the same cut without subtitles (the stage's source)
const DEPLOY = path.resolve(opt('deploy', 'demo/deploy.mp4'));        // human desktop capture (F16.3)
const WARM = Number(opt('warm', '40'));
const STAGES = Number(opt('stages', '8'));
const REPLAY = process.argv.includes('--replay');
const PORT = 18400;
const B = `http://127.0.0.1:${PORT}`;
const REPO = 'github.com/tomas-nobile/everyone-makes-subs';
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'ems-video-'));
const electron = createRequire(import.meta.url)('electron') as unknown as string;

function run(bin: string, args: string[], opts: { cwd?: string; quiet?: boolean } = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { cwd: opts.cwd, stdio: ['ignore', opts.quiet ? 'ignore' : 'inherit', 'inherit'] });
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${path.basename(bin)} exited with ${code}`))));
  });
}
const ff = (args: string[]) => run(ffmpegPath as unknown as string, ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const s1 = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

// ── measured numbers (never typed in) ──
function latestJson<T>(dir: string, prefix: string, ok: (x: T) => boolean = () => true): T | null {
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir).filter((f) => f.startsWith(prefix) && f.endsWith('.json')).sort().reverse();
  for (const f of files) {
    const x = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as T;
    if (ok(x)) return x;
  }
  return null;
}
interface Bench { fake: boolean; summary: { columns: Array<{ name: string; p50: number; p95: number; n: number }>; timeToFirstCaptionMs: Array<number | null>; phrasesPerMin: number } }
interface Scale { stages: number; viewers: number; spreadP95Ms: number; spreadP50Ms: number; cpuAvgPct: number; cpuMaxPct: number; rssIdleMb: number; rssMb: number; machine: string }
interface Pricing { asOf: string; perRoomHour: Record<string, { es: number; esPt: number; measured?: boolean; label: string }>; nerdearlaDay: { roomHours: number }; audienceLine: string }
interface Ab { lines: Array<{ term: string; without: string; with: string }>; hitsWithout: number; hitsWith: number }
const bench = latestJson<Bench>('bench', 'latency-', (b) => !b.fake);
const scale = latestJson<Scale>('bench', 'scale-');
const pricing: Pricing | null = fs.existsSync('docs/pricing.json') ? JSON.parse(fs.readFileSync('docs/pricing.json', 'utf8')) : null;
const ab: Ab | null = fs.existsSync('demo/ab/ab.json') ? JSON.parse(fs.readFileSync('demo/ab/ab.json', 'utf8')) : null;
const deploy: { seconds: number; secondsInVideo?: number; fast?: { from: number; to: number; factor: number } | null } | null = fs.existsSync('demo/deploy.json') ? JSON.parse(fs.readFileSync('demo/deploy.json', 'utf8')) : null;
const col = (name: string) => bench?.summary.columns.find((c) => c.name === name);
const pauseEs = col('pause → Spanish');
const ttfc = bench ? bench.summary.timeToFirstCaptionMs.filter((x): x is number => x !== null).sort((a, b) => a - b) : [];
const ttfcMed = ttfc.length ? ttfc[Math.floor(ttfc.length / 2)] : null;
const missing: string[] = [];
if (!bench) missing.push('bench/latency-*.json (npm run bench:latency)');
if (!scale) missing.push('bench/scale-*.json (npm run load -- --stages=8 --clients=2000)');
if (!pricing) missing.push('docs/pricing.json');
if (!fs.existsSync(CLIP)) missing.push(`${path.relative('.', CLIP)} (npm run clip -- <url> --src-lang=en --lang=es --out=demo/clip)`);
if (missing.length) console.log(`[video] missing, the chapter will say so instead of inventing a number:\n  - ${missing.join('\n  - ')}`);

// ── panels: HTML pages rendered to PNGs with alpha, overlaid by ffmpeg ──
interface Panel { kicker?: string; title?: string; body?: string; rows?: string[][]; note?: string; style: 'side' | 'center' | 'lower' | 'badge'; hold?: number }
const BASE_CSS = `html,body{margin:0;background:transparent;width:1280px;height:720px;overflow:hidden;font-family:"Atkinson Hyperlegible","Segoe UI",system-ui,sans-serif;color:#F2F2F2}
.k{color:#FFD24A;letter-spacing:.14em;text-transform:uppercase;font-size:18px;font-weight:700}
.t{font-size:38px;font-weight:700;line-height:1.15}
.b{font-size:21px;color:#A3A9B1;line-height:1.4}
.n{font-size:14px;color:#6B717A;line-height:1.35}
table{border-collapse:collapse;font-size:19px;margin-top:6px}td{padding:6px 14px 6px 0;vertical-align:top;color:#A3A9B1}td:first-child{color:#F2F2F2}tr.hl td{color:#FFD24A}
code{font-family:ui-monospace,Menlo,monospace;font-size:.9em;color:#F2F2F2}`;
let panels = 0;
function panelHtml(p: Panel): string {
  const rows = p.rows ? `<table>${p.rows.map((r) => `<tr${r[0]?.startsWith('★') ? ' class="hl"' : ''}>${r.map((c) => `<td>${c.replace(/^★ ?/, '')}</td>`).join('')}</tr>`).join('')}</table>` : '';
  const inner = `${p.kicker ? `<div class="k">${p.kicker}</div>` : ''}${p.title ? `<div class="t">${p.title}</div>` : ''}${p.body ? `<div class="b">${p.body}</div>` : ''}${rows}${p.note ? `<div class="n">${p.note}</div>` : ''}`;
  const box = p.style === 'badge'
    ? `<div style="position:absolute;right:32px;top:28px;background:#FFD24A;color:#1A1400;font-weight:700;font-size:34px;padding:8px 18px;border-radius:12px">${p.title ?? ''}</div>`
    : p.style === 'side'
    ? `<div style="position:absolute;left:0;top:0;bottom:0;width:540px;background:rgba(11,12,14,.93);padding:56px 48px;box-sizing:border-box;display:flex;flex-direction:column;justify-content:center;gap:16px">${inner}</div>`
    : p.style === 'center'
      ? `<div style="position:absolute;inset:0;background:rgba(11,12,14,.78);display:flex;flex-direction:column;justify-content:center;padding:0 140px;gap:18px"><style>.t{font-size:60px}.b{font-size:27px}</style>${inner}</div>`
      : `<div style="position:absolute;left:0;right:0;bottom:0;height:96px;background:rgba(11,12,14,.9);display:flex;align-items:center;padding:0 48px;gap:22px;box-sizing:border-box"><style>.t{font-size:26px}.b{font-size:20px}</style>${inner}</div>`;
  const file = path.join(work, `panel-${++panels}.html`);
  fs.writeFileSync(file, `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS}</style></head><body>${box}</body></html>`);
  return pathToFileURL(file).href;
}

// ── footage pages that are not routes of the app ──
let pages = 0;
const page = (body: string, css = '') => {
  const file = path.join(work, `page-${++pages}.html`);
  fs.writeFileSync(file, `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;height:100%;background:#0B0C0E;color:#F2F2F2;font-family:"Atkinson Hyperlegible","Segoe UI",system-ui,sans-serif}${css}</style></head><body>${body}</body></html>`);
  return pathToFileURL(file).href;
};
const phonesPage = (stage: string) => page(`<div style="display:flex;gap:34px;justify-content:center;align-items:center;height:100%">
${[['es', 'Español · traducción'], ['en', 'English · original'], ['pt', 'Português · tradução']].map(([l, label]) => `<div style="text-align:center">
<iframe src="${B}/s/${stage}?lang=${l}" style="width:360px;height:620px;border:1px solid #2a2d33;border-radius:22px;background:#000"></iframe>
<div style="margin-top:10px;color:#A3A9B1;font-size:20px">${label}</div></div>`).join('')}</div>`);
const overlayPage = (stage: string) => page(`<div style="position:absolute;inset:0;background:radial-gradient(circle at 30% 35%,#3a4a63,#0d1117 70%)"></div>
<div style="position:absolute;left:8%;top:10%;width:55%;height:55%;border-radius:14px;background:linear-gradient(160deg,#e8ecf2,#c9d1dc);opacity:.9;color:#1c2330;padding:30px;box-sizing:border-box;font-size:34px;font-weight:700">Model Context Protocol<div style="font-size:20px;font-weight:400;margin-top:14px">clients · servers · tools · OAuth</div></div>
<div style="position:absolute;right:6%;top:18%;width:24%;height:40%;border-radius:14px;background:#2b3240"></div>
<div style="position:absolute;left:12px;top:12px;background:rgba(0,0,0,.55);color:#fff;font-size:16px;padding:4px 10px;border-radius:6px">OBS · Browser source</div>
<iframe src="${B}/s/${stage}/overlay?lang=es&lines=2&size=38&box=1" style="position:absolute;inset:0;width:100%;height:100%;border:0" allowtransparency="true"></iframe>`);

// ── the parts of the film ──
/** `badge`: a small panel shown only between two times of the part (the "×4" of the sped-up installer, F16.3). */
type Part =
  | { kind: 'frames'; url: string; seconds: number; warm?: number; js?: string; panel?: Panel; badge?: { panel: Panel; from: number; to: number } }
  | { kind: 'video'; file: string; from?: number; seconds: number; panel?: Panel; fadeOut?: boolean; badge?: { panel: Panel; from: number; to: number } }
  | { kind: 'split'; seconds: number; panel?: Panel; badge?: { panel: Panel; from: number; to: number } };   // clip (left, with audio) + phone in Spanish (right), same clock
const api = async <T>(method: string, p: string, body?: unknown): Promise<T> => {
  const res = await fetch(`${B}${p}`, { method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
  if (!res.ok) throw new Error(`${method} ${p} → ${res.status}`);
  return res.json() as Promise<T>;
};

console.log(`[video] starting the server (DEMO=1, ${STAGES} rooms${REPLAY ? ', replaying recorded runs' : ', live'}) and letting captions build up for ${WARM} s…`);
const server = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], {
  env: { ...process.env, DEMO: '1', DEMO_STAGES: String(STAGES), PORT: String(PORT), DATA_DIR: path.join(work, 'data'), EVENT_NAME: 'Nerdearla 2026', ADMIN_PASSWORD: '', ...(REPLAY ? { FAKE_BACKEND: '1' } : {}) },
  stdio: ['ignore', 'ignore', 'inherit'],
});
try {
  for (let i = 0; ; i++) {
    try { if ((await fetch(`${B}/api/health`)).ok) break; } catch { /* booting */ }
    if (i > 150) throw new Error('server did not start');
    await sleep(200);
  }
  // viewers so the dashboard does not say "0 reading"; a video job so the Innovation chapter shows one done
  const viewers = [0, 1, 2, 3, 4].map((i) => fetch(`${B}/api/stages/${i % 2 ? 'room-2' : 'auditorium'}/stream`).catch(() => null));
  if (fs.existsSync(RAW_CLIP)) {
    await fetch(`${B}/api/jobs?${new URLSearchParams({ name: path.basename(RAW_CLIP), lang: 'es', srcLang: 'en', title: 'A talk from last year, in Spanish' })}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: fs.readFileSync(RAW_CLIP) }).catch(() => null);
  }
  const stages = await api<Array<{ id: string; stationKey: string }>>('GET', '/api/stages');
  const stationKey = stages[0]?.stationKey ?? '';
  // the clip as a room of its own: in --replay it replays demo/clip.transcript.json with the recorded timing (F16.5)
  let clipStage: string | null = null;
  if (fs.existsSync(RAW_CLIP)) {
    const meta = fs.existsSync(RAW_CLIP.replace(/\.mp4$/, '.transcript.json')) ? JSON.parse(fs.readFileSync(RAW_CLIP.replace(/\.mp4$/, '.transcript.json'), 'utf8')) as { title: string; speaker?: string; lang: string } : { title: 'Talk clip', lang: 'en' };
    const st = await api<{ id: string }>('POST', '/api/stages', { name: 'Talk clip', source: { kind: 'file', path: RAW_CLIP, loop: false }, targetLangs: ['es', 'en', 'pt'] });
    await api('POST', `/api/stages/${st.id}/talk`, { title: meta.title, speaker: meta.speaker, lang: meta.lang || 'en' });
    clipStage = st.id;
  }
  await sleep(WARM * 1000);
  // a talk due now on Room 3 → the "Move to the next talk?" alert; no audio on Room 2 → the alert with its button (replay only)
  await api('POST', '/api/stages/room-3/talk', { title: 'Observability on a budget: OpenTelemetry end to end', speaker: 'Priya Raman', lang: 'en', startsAt: new Date().toISOString(), queue: true }).catch(() => null);
  if (REPLAY) await fetch(`${B}/api/dev/state?stage=room-2&state=no_signal`).catch(() => null);

  const P = {
    open: { style: 'center', kicker: 'Nerdearla Vibeathon 2026', title: 'Everyone Makes Subs', body: 'Live captions and translation for every stage of a conference, with a single Gemini API key.', hold: 4 } as Panel,
    deploy: { style: 'side', kicker: 'Deployment & operation', title: 'Double-click the installer. Paste the key. Done.', body: 'No terminal, no server: the key stays on your machine. Prefer a server? <code>docker compose up</code>.', hold: 4.5 } as Panel,
    deployClock: deploy ? ({ style: 'lower', kicker: 'Deployment', title: `From double-click to captions: ${Math.round(deploy.seconds)} s`, hold: 99 } as Panel) : undefined,
    alert: { style: 'lower', kicker: 'Operation', title: 'An alert in plain language, with the button that fixes it.', hold: 99 } as Panel,
    schedule: { style: 'lower', kicker: 'Operation', title: 'The agenda drives the day: “Move to the next talk?” at the scheduled time.', hold: 99 } as Panel,
    quality: { style: 'side', kicker: 'Quality', title: 'It knows the vocabulary before the talk starts.', body: 'From the title and abstract, Gemini builds the terms to listen for and the glossary to translate with.', hold: 5 } as Panel,
    hits: { style: 'lower', kicker: 'Quality', title: 'Every term counted live in the dashboard: “Kubernetes ✓ 9”.', hold: 99 } as Panel,
    ab: ab && ab.lines.length ? ({ style: 'side', kicker: 'Quality · A/B, same clip', title: 'Without the glossary → with it', rows: ab.lines.slice(0, 3).map((l) => [l.term, l.without, l.with]), note: 'Both lines are the pipeline’s own output (demo/ab/).', hold: 7 } as Panel)
      : ab ? ({ style: 'side', kicker: 'Quality · A/B, same clip', title: 'Same words with and without the glossary', body: `Vocabulary hits: ${ab.hitsWithout} without it, ${ab.hitsWith} with it.`, hold: 6 } as Panel) : undefined,
    latency: { style: 'side', kicker: 'Latency', title: 'Watch it translate.', body: pauseEs ? `End of a sentence → Spanish caption on the phone: p50 ${s1(pauseEs.p50)}, p95 ${s1(pauseEs.p95)} over ${pauseEs.n} phrases. Left and right run on the same clock.` : 'Latency numbers come from <code>npm run bench:latency</code> (not run yet).', note: ttfcMed !== null ? `Time to first caption after pressing Start: ${s1(ttfcMed)}. LAN numbers; a tunnel adds its own hop.` : undefined, hold: 6 } as Panel,
    scale1: { style: 'side', kicker: 'Scalability', title: 'One process, every room, any audience.', body: 'One speech session per room — not per language, not per viewer. Viewers add zero AI cost.', hold: 5 } as Panel,
    scale2: { style: 'lower', kicker: 'Scalability', title: scale ? `${scale.stages} rooms × ${Math.round(scale.viewers / scale.stages)} viewers on one laptop: every phrase to every viewer within ${scale.spreadP95Ms} ms (p95).` : 'Load numbers come from npm run load (not run yet).', hold: 99 } as Panel,
    scale3: { style: 'lower', kicker: 'Scalability', title: scale ? `${scale.stages} rooms in one process: ${scale.cpuAvgPct}% of one core, ${scale.rssMb} MB. More viewers: web replicas behind a CDN, same image.` : 'More viewers: web replicas behind a CDN, same image.', hold: 99 } as Panel,
    price: pricing ? ({ style: 'side', kicker: 'Price', title: 'Per room-hour, Spanish + Portuguese', rows: [
      ...Object.values(pricing.perRoomHour).map((r) => [`${r.measured ? '★ ' : ''}${r.label}`, `US$ ${r.esPt.toFixed(2)}`]),
      [`Nerdearla day (${pricing.nerdearlaDay.roomHours} room-hours)`, `US$ ${(pricing.perRoomHour.ems.esPt * pricing.nerdearlaDay.roomHours).toFixed(0)}`],
    ], body: pricing.audienceLine, note: `List prices as of ${pricing.asOf}, see docs/pricing.md`, hold: 99 } as Panel) : ({ style: 'side', kicker: 'Price', title: 'Costs come from docs/pricing.md', body: 'Not written yet.', hold: 99 } as Panel),
    close: { style: 'center', kicker: 'Open source · MIT', title: REPO, body: 'One Gemini API key. Installer, Docker or npm run dev.', hold: 5 } as Panel,
  };
  const label = (title: string): Panel => ({ style: 'lower', kicker: 'Innovation', title, hold: 99 });
  const admin = (js?: string, seconds = 8): Part => ({ kind: 'frames', url: `${B}/admin`, seconds, warm: 3000, js });
  const clickCard = (n = 0) => `document.querySelectorAll('button.card')[${n}]?.click()`;
  const hasClip = fs.existsSync(CLIP);
  const parts: Part[] = [];
  // opening: the result first — the clip, Spanish captions burned in
  if (hasClip) parts.push({ kind: 'video', file: CLIP, from: 0, seconds: 12, panel: P.open });
  else parts.push({ kind: 'frames', url: phonesPage('auditorium'), seconds: 6, warm: 4000, panel: P.open });
  // 1. deployment & operation
  if (fs.existsSync(DEPLOY)) {
    // the human capture: the whole thing up to the first caption (+3 s), the installer's progress at ×4 with a badge
    const total = Math.max(8, (deploy?.secondsInVideo ?? deploy?.seconds ?? 20) + 3);
    const badge = deploy?.fast ? { panel: { style: 'badge', title: `×${deploy.fast.factor}` } as Panel, from: deploy.fast.from, to: deploy.fast.to } : undefined;
    parts.push({ kind: 'video', file: DEPLOY, seconds: Math.min(total, 22), panel: P.deploy, badge, fadeOut: false });
    if (P.deployClock) parts.push({ kind: 'video', file: DEPLOY, from: Math.max(0, total - 5), seconds: 5, panel: P.deployClock });
  } else parts.push({ kind: 'frames', url: `${B}/setup`, seconds: 9, warm: 2500, panel: P.deploy });
  parts.push(admin(undefined, 6), { kind: 'frames', url: `${B}/admin`, seconds: 5, warm: 3000, panel: P.alert }, { kind: 'frames', url: `${B}/admin`, seconds: 5, warm: 3000, panel: P.schedule });
  // 2. quality
  if (hasClip) parts.push({ kind: 'video', file: CLIP, from: 12, seconds: 9, panel: P.quality });
  else parts.push({ kind: 'frames', url: phonesPage('auditorium'), seconds: 7, warm: 4000, panel: P.quality });
  parts.push({ kind: 'frames', url: `${B}/admin`, seconds: 8, warm: 3000, js: clickCard(0), panel: P.hits });
  if (P.ab) parts.push(hasClip ? { kind: 'video', file: CLIP, from: 21, seconds: 8, panel: P.ab } : { kind: 'frames', url: phonesPage('auditorium'), seconds: 8, warm: 4000, panel: P.ab });
  // 3. latency: split screen, same clock
  if (clipStage) parts.push({ kind: 'split', seconds: 24, panel: P.latency });
  else parts.push({ kind: 'frames', url: phonesPage('auditorium'), seconds: 14, warm: 4000, panel: P.latency });
  // 4. scalability
  parts.push(admin(undefined, 10), { kind: 'frames', url: `${B}/admin`, seconds: 7, warm: 3000, panel: P.scale2 }, { kind: 'frames', url: `${B}/admin`, seconds: 7, warm: 3000, js: "document.querySelector('input.switch')?.click()", panel: P.scale3 });
  parts[parts.length - 3].panel = P.scale1;
  // 5. innovation: a montage, each item working
  parts.push(
    { kind: 'frames', url: `${B}/admin`, seconds: 5, warm: 3000, js: "document.querySelector('.jobs')?.scrollIntoView()", panel: label('Subtitle a video: upload it, get it back with Spanish subtitles burned in, plus SRT/VTT.') },
    { kind: 'frames', url: overlayPage('auditorium'), seconds: 4, warm: 3000, panel: label('A transparent overlay for OBS — and a YouTube or stream link as the audio source.') },
    { kind: 'frames', url: `${B}/s/auditorium?lang=es`, seconds: 4, warm: 3500, js: "[...document.querySelectorAll('button.pill-btn')].at(-1)?.click()", panel: label('“What did I miss?” — a summary of the last five minutes, in your language.') },
    { kind: 'frames', url: `${B}/admin`, seconds: 4, warm: 3000, js: clickCard(2), panel: label('Paste the agenda: rooms, talks and vocabulary come out of it.') },
    { kind: 'frames', url: `${B}/station/auditorium?key=${stationKey}`, seconds: 4, warm: 2500, panel: label('The room laptop is the microphone: open a link, pick the input.') },
    { kind: 'frames', url: `${B}/s/auditorium/tv?lang=es&qr=1`, seconds: 4, warm: 3000, panel: label('TV mode: two giant lines and the QR code for the phones.') },
    { kind: 'frames', url: `${B}/s/auditorium?lang=es`, seconds: 4, warm: 3500, js: "document.querySelector('.icon-btn')?.click()", panel: label('Watching a stream? Delay the captions to match it. Downloads when the talk ends.') },
  );
  // 6. price
  parts.push({ kind: 'frames', url: `${B}/admin`, seconds: 14, warm: 3000, js: "document.querySelector('input.switch')?.click()", panel: P.price });
  // closing
  parts.push({ kind: 'frames', url: phonesPage('auditorium'), seconds: 5, warm: 4000, panel: P.close });

  // ── 1. panels → PNG, footage → frames (one Electron pass), then the split screen (its own clock) ──
  const panelPng = new Map<Panel, string>();
  const scenes: object[] = [];
  for (const p of parts) for (const pan of [p.panel, p.badge?.panel]) if (pan && !panelPng.has(pan)) { const png = path.join(work, `panel-${panelPng.size + 1}.png`); panelPng.set(pan, png); scenes.push({ url: panelHtml(pan), png }); }
  const dirs = new Map<Part, string>();
  parts.forEach((p, i) => { if (p.kind === 'frames') { const dir = path.join(work, `scene-${String(i).padStart(2, '0')}`); dirs.set(p, dir); scenes.push({ url: p.url, seconds: p.seconds, warm: p.warm, js: p.js, dir }); } });
  const plan = path.join(work, 'plan.json');
  fs.writeFileSync(plan, JSON.stringify({ width: 1280, height: 720, scenes }));
  console.log(`[video] rendering ${panelPng.size} panels and recording ${dirs.size} scenes…`);
  await run(electron, [path.resolve('scripts/record-scenes.cjs'), plan]);
  await fetch(`${B}/api/dev/state?stage=room-2&state=`).catch(() => null);

  const split = parts.find((p): p is Extract<Part, { kind: 'split' }> => p.kind === 'split');
  let splitFile: string | null = null;
  if (split && clipStage) {
    // start the clip's room and record the phone from the same clock; the clip's audio is offset by the measured delay
    const dir = path.join(work, 'split-phone');
    const plan2 = path.join(work, 'plan-split.json');
    fs.writeFileSync(plan2, JSON.stringify({ width: 440, height: 720, scenes: [{ url: `${B}/s/${clipStage}?lang=es`, seconds: split.seconds, warm: 200, dir }] }));
    const stageStartAt = Date.now();
    await api('POST', `/api/stages/${clipStage}/start`);
    console.log('[video] recording the split screen (clip room live, phone in Spanish)…');
    await run(electron, [path.resolve('scripts/record-scenes.cjs'), plan2]);
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')) as { frames: number; seconds: number; startedAt: number };
    const delay = Math.max(0, (meta.startedAt - stageStartAt) / 1000);
    const fps = (meta.frames / meta.seconds).toFixed(3);
    splitFile = path.join(work, 'split.mp4');
    await ff(['-ss', delay.toFixed(2), '-i', RAW_CLIP, '-framerate', fps, '-i', path.join(dir, '%05d.jpg'),
      '-filter_complex', '[0:v]scale=840:-2:flags=lanczos,pad=840:720:0:(oh-ih)/2:color=0x0B0C0E[l];[1:v]scale=-2:720[r];[l][r]hstack=inputs=2,pad=1280:720:0:0:color=0x0B0C0E,fps=25,format=yuv420p[v]',
      '-map', '[v]', '-map', '0:a:0', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-c:a', 'aac', '-ar', '44100', '-ac', '2', '-t', String(meta.seconds), splitFile]);
    console.log(`[video] split screen: audio offset ${delay.toFixed(2)} s, ${meta.frames} frames`);
  }
  void viewers;

  // ── 2. encode every part the same way (panel overlaid, fading out after `hold`), then join ──
  const vf = 'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=0x0B0C0E,fps=25';
  const enc = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-c:a', 'aac', '-ar', '44100', '-ac', '2'];
  const encoded: string[] = [];
  for (const [i, p] of parts.entries()) {
    const out = path.join(work, `part-${String(i).padStart(2, '0')}.mp4`);
    const inputs: string[] = [];
    let seconds = p.seconds;
    if (p.kind === 'frames') {
      const meta = JSON.parse(fs.readFileSync(path.join(dirs.get(p)!, 'meta.json'), 'utf8')) as { frames: number; seconds: number };
      inputs.push('-framerate', (meta.frames / meta.seconds).toFixed(3), '-i', path.join(dirs.get(p)!, '%05d.jpg'), '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo');
      seconds = meta.seconds;
    } else if (p.kind === 'video') inputs.push('-ss', String(p.from ?? 0), '-t', String(p.seconds), '-i', p.file);
    else if (splitFile) inputs.push('-i', splitFile);
    else continue;
    const hold = Math.min(p.panel?.hold ?? 4, seconds);
    const filters = [`[0:v]${vf}[v0]`];
    let next = p.kind === 'frames' ? 2 : 1;   // index of the next input
    let cur = 'v0';
    if (p.panel) {
      inputs.push('-loop', '1', '-t', String(hold + 0.5), '-i', panelPng.get(p.panel)!);
      filters.push(`[${next}:v]format=rgba${hold < seconds ? `,fade=t=out:st=${hold}:d=0.4:alpha=1` : ''}[p]`, `[${cur}][p]overlay=0:0:eof_action=pass[v1]`);
      next++;
      cur = 'v1';
    }
    if (p.badge) {
      inputs.push('-loop', '1', '-t', String(seconds), '-i', panelPng.get(p.badge.panel)!);
      filters.push(`[${next}:v]format=rgba[bd]`, `[${cur}][bd]overlay=0:0:eof_action=pass:enable='between(t,${p.badge.from.toFixed(2)},${p.badge.to.toFixed(2)})'[v2]`);
      cur = 'v2';
    }
    filters.push(`[${cur}]${p.kind === 'video' && p.fadeOut !== false ? `fade=t=out:st=${Math.max(0, seconds - 0.5)}:d=0.5,` : ''}format=yuv420p[out]`);
    const audio = p.kind === 'frames' ? '1:a' : '0:a:0';
    await ff([...inputs, '-filter_complex', filters.join(';'), '-map', '[out]', '-map', audio, '-t', String(seconds), ...enc, '-shortest', out]);
    encoded.push(out);
  }
  const list = path.join(work, 'list.txt');
  fs.writeFileSync(list, encoded.map((p) => `file '${p.replace(/\\/g, '/')}'`).join('\n'));
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  await ff(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', OUT]);
  const total = parts.reduce((n, p) => n + p.seconds, 0);
  console.log(`[video] done: ${path.relative('.', OUT)} (${parts.length} parts, ~${Math.floor(total / 60)}:${String(Math.round(total % 60)).padStart(2, '0')})`);
} finally {
  server.kill();
}
process.exit(0);
