// F15.2: builds the 1–2 min demo video from the running system — no screen recorder needed.
// Boots the server with DEMO=1 (real pipelines on samples/ with a key; replays without one),
// records every view with Electron, and joins title cards + the subtitled clip of a real talk
// (from `npm run clip`) + the scenes into one mp4 with ffmpeg.
// Usage: npm run demo-video [-- --clip=demo/clip.en.mp4 --clip-max=35 --out=demo/demo.mp4 --warm=40 --replay]
//   --replay: the rooms replay samples/*.transcript.json (real pipeline output recorded by
//             `npm run samples`) instead of running live — no quota involved while recording.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ffmpegPath from 'ffmpeg-static';

const opt = (n: string, d: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=') ?? d;
const OUT = path.resolve(opt('out', 'demo/demo.mp4'));
const CLIP = path.resolve(opt('clip', 'demo/clip.en.mp4'));
const WARM = Number(opt('warm', '40'));
const CLIP_MAX = Number(opt('clip-max', '35'));
const REPLAY = process.argv.includes('--replay');
const PORT = 18400;
const B = `http://127.0.0.1:${PORT}`;
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'ems-video-'));
const electron = createRequire(import.meta.url)('electron') as unknown as string;

function run(bin: string, args: string[], opts: { cwd?: string; quiet?: boolean } = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { cwd: opts.cwd, stdio: ['ignore', opts.quiet ? 'ignore' : 'inherit', 'inherit'] });
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${path.basename(bin)} exited with ${code}`))));
  });
}
const ff = (args: string[]) => run(ffmpegPath as unknown as string, ['-hide_banner', '-loglevel', 'error', '-y', ...args]);

// ── title cards (the prototype's look) ──
let pages = 0;
const page = (body: string, css = '') => {
  const file = path.join(work, `page-${++pages}.html`);
  fs.writeFileSync(file, `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;height:100%;background:#0B0C0E;color:#F2F2F2;font-family:"Atkinson Hyperlegible","Segoe UI",system-ui,sans-serif}${css}</style></head><body>${body}</body></html>`);
  return pathToFileURL(file).href;
};
const card = (title: string, sub = '', kicker = '') => page(`<div style="height:100%;display:flex;flex-direction:column;justify-content:center;padding:0 110px;gap:22px">
${kicker ? `<div style="color:#FFD24A;letter-spacing:.12em;text-transform:uppercase;font-size:22px">${kicker}</div>` : ''}
<div style="font-size:60px;font-weight:700;line-height:1.1">${title}</div>
${sub ? `<div style="font-size:28px;color:#A3A9B1;line-height:1.35;max-width:1000px">${sub}</div>` : ''}</div>`);

const phones = page(`<div style="display:flex;gap:34px;justify-content:center;align-items:center;height:100%">
${[['es', 'Español · original'], ['en', 'English · translation'], ['pt', 'Português · tradução']].map(([l, label]) => `<div style="text-align:center">
<iframe src="${B}/s/auditorium?lang=${l}" style="width:360px;height:620px;border:1px solid #2a2d33;border-radius:22px;background:#000"></iframe>
<div style="margin-top:10px;color:#A3A9B1;font-size:20px">${label}</div></div>`).join('')}</div>`);

const overlay = page(`<div style="position:absolute;inset:0;background:radial-gradient(circle at 30% 35%,#3a4a63,#0d1117 70%)"></div>
<div style="position:absolute;left:8%;top:10%;width:55%;height:55%;border-radius:14px;background:linear-gradient(160deg,#e8ecf2,#c9d1dc);opacity:.9;color:#1c2330;padding:30px;box-sizing:border-box;font-size:34px;font-weight:700">Kubernetes performance<div style="font-size:20px;font-weight:400;margin-top:14px">requests · limits · HPA</div></div>
<div style="position:absolute;right:6%;top:18%;width:24%;height:40%;border-radius:14px;background:#2b3240"></div>
<div style="position:absolute;left:12px;top:12px;background:rgba(0,0,0,.55);color:#fff;font-size:16px;padding:4px 10px;border-radius:6px">OBS · Browser source</div>
<iframe src="${B}/s/room-2/overlay?lang=es&lines=2&size=38&box=1" style="position:absolute;inset:0;width:100%;height:100%;border:0" allowtransparency="true"></iframe>`);

type Scene = { url: string; seconds: number; warm?: number; js?: string; dir?: string } | { video: string };
const scenes: Scene[] = [
  { url: card('Everyone Makes Subs', 'Live captions and translation for every stage of your conference — with a single Gemini API key.', 'Nerdearla Vibeathon 2026'), seconds: 4.5 },
];
if (fs.existsSync(CLIP)) {
  scenes.push({ url: card('A real Nerdearla talk, in Spanish', 'The English subtitles below were generated live by Everyone Makes Subs: Gemini Live transcription → phrase segmentation → translation.', 'The result'), seconds: 4 });
  scenes.push({ video: CLIP });
} else {
  console.log(`[video] no ${path.relative('.', CLIP)} yet: run \`npm run clip -- <youtube-url> --from=… --to=…\` to include the subtitled talk`);
}
scenes.push(
  { url: card('Two rooms, live, in parallel', `The operator sees every room in plain language: live, no audio, delayed — plus the last line written.${REPLAY ? '<br><span style="font-size:20px;color:#6f757d">These rooms replay a recorded run of the real pipeline over two Nerdearla talks.</span>' : ''}`, 'Dashboard'), seconds: 3.5 },
  { url: `${B}/admin`, seconds: 9, warm: 3000 },
  { url: card('Vocabulary per talk, visibly working', 'Gemini builds each talk\'s vocabulary from its title and abstract; the dashboard counts every hit.', 'Dashboard · Talk'), seconds: 3.5 },
  { url: `${B}/admin`, seconds: 8, warm: 3000, js: "document.querySelector('button.card')?.click()" },
  { url: card('Scan the QR, read in your language', 'One stream per room carries every language: the phone picks yours, switching never reconnects.', 'Phone'), seconds: 3.5 },
  { url: phones, seconds: 13, warm: 4000 },
  { url: card('The room screen', 'Two giant lines and a QR code: "Captions in your language".', 'TV mode'), seconds: 3 },
  { url: `${B}/s/auditorium/tv?lang=en&qr=1`, seconds: 8, warm: 3000 },
  { url: card('Captions on the stream', 'A transparent overlay for OBS, configured from the dashboard.', 'OBS overlay'), seconds: 3 },
  { url: overlay, seconds: 8, warm: 3000 },
  { url: card('Download. Paste the key. Paste the agenda.', 'Installer or <code>docker compose up</code>. Rotation without gaps, reconnection, SRT/VTT export, "what did I miss?" summary. Open source, MIT.', 'Everyone Makes Subs'), seconds: 5 },
);

// ── 1. the system, running ──
console.log(`[video] starting the server (DEMO=1${REPLAY ? ', replaying the recorded samples' : ', live'}) and letting captions build up for ${WARM} s…`);
const server = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], {
  env: { ...process.env, DEMO: '1', PORT: String(PORT), DATA_DIR: path.join(work, 'data'), EVENT_NAME: 'Nerdearla 2026', ...(REPLAY ? { FAKE_BACKEND: '1' } : {}) },
  stdio: ['ignore', 'ignore', 'inherit'],
});
try {
  for (let i = 0; ; i++) {
    try { if ((await fetch(`${B}/api/health`)).ok) break; } catch { /* booting */ }
    if (i > 150) throw new Error('server did not start');
    await new Promise((r) => setTimeout(r, 200));
  }
  // 3 viewers so the dashboard does not say "0 reading"
  const viewers = [0, 1, 2].map(() => fetch(`${B}/api/stages/auditorium/stream`).catch(() => null));
  await new Promise((r) => setTimeout(r, WARM * 1000));

  // ── 2. record ──
  const recorded = scenes.map((s, i) => ('url' in s ? { ...s, dir: path.join(work, `scene-${String(i).padStart(2, '0')}`) } : s));
  const plan = path.join(work, 'plan.json');
  fs.writeFileSync(plan, JSON.stringify({ width: 1280, height: 720, scenes: recorded.filter((s) => 'url' in s) }));
  console.log(`[video] recording ${recorded.filter((s) => 'url' in s).length} scenes…`);
  await run(electron, [path.resolve('scripts/record-scenes.cjs'), plan]);
  void viewers;

  // ── 3. encode each part the same way, then join ──
  const vf = 'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=0x0B0C0E,fps=25,format=yuv420p';
  const enc = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-c:a', 'aac', '-ar', '44100', '-ac', '2'];
  const parts: string[] = [];
  for (const [i, s] of recorded.entries()) {
    const part = path.join(work, `part-${String(i).padStart(2, '0')}.mp4`);
    if ('video' in s) {
      await ff(['-i', s.video, ...(CLIP_MAX ? ['-t', String(CLIP_MAX)] : []), '-vf', `${vf},fade=t=out:st=${Math.max(0, CLIP_MAX - 0.6)}:d=0.6`, '-af', `afade=t=out:st=${Math.max(0, CLIP_MAX - 0.6)}:d=0.6`, ...enc, part]);
    } else {
      const meta = JSON.parse(fs.readFileSync(path.join(s.dir!, 'meta.json'), 'utf8')) as { frames: number; seconds: number };
      const fps = (meta.frames / meta.seconds).toFixed(3);
      await ff(['-framerate', fps, '-i', path.join(s.dir!, '%05d.jpg'), '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo', '-vf', vf, ...enc, '-shortest', part]);
    }
    parts.push(part);
  }
  const list = path.join(work, 'list.txt');
  fs.writeFileSync(list, parts.map((p) => `file '${p.replace(/\\/g, '/')}'`).join('\n'));
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  await ff(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', OUT]);
  console.log(`[video] done: ${path.relative('.', OUT)}`);
} finally {
  server.kill();
}
process.exit(0);
