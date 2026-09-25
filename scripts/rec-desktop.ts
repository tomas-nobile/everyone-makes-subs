// F16.3: records the desktop (ffmpeg gdigrab, Windows) while a human installs the app and gets the
// first Spanish caption on the phone view, then trims the dead time and speeds up the installer's
// progress bar. Everything is timed from the key presses, so the stopwatch in the video is measured.
//
// Usage: npm run rec:desktop [-- --out=demo/deploy.mp4 --fps=15 --seconds=180]
//   Start it, then double-click the installer at once. While it records, press:
//     f  when the installer's progress bar starts   (that stretch is played at ×4)
//     n  when the installer is done
//     c  when the first Spanish caption appears on the phone view   (the stopwatch stops here)
//     q  to stop recording
//   Output: demo/deploy.mp4 (from the start to c + 3 s) and demo/deploy.json { seconds, fast: { from, to } },
//   which the demo video uses for "From double-click to captions: N s" and the ×4 badge.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import ffmpegPath from 'ffmpeg-static';

const opt = (n: string, d: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=') ?? d;
const OUT = path.resolve(opt('out', 'demo/deploy.mp4'));
const FPS = opt('fps', '15');
const MAX = Number(opt('seconds', '180'));
const SPEED = 4;
const raw = OUT.replace(/\.mp4$/, '.raw.mp4');
fs.mkdirSync(path.dirname(OUT), { recursive: true });

if (process.platform !== 'win32') { console.log('gdigrab is Windows only; on Mac use avfoundation, on Linux x11grab (edit the input line).'); process.exit(2); }
const rec = spawn(ffmpegPath as unknown as string, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'gdigrab', '-framerate', FPS, '-i', 'desktop', '-t', String(MAX),
  '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23', '-pix_fmt', 'yuv420p', raw], { stdio: ['pipe', 'ignore', 'inherit'] });
const t0 = Date.now();
const at = () => (Date.now() - t0) / 1000;
const marks: Record<string, number> = {};
console.log('[rec] recording the desktop. Double-click the installer now. Keys: f (installer starts) · n (installer done) · c (first caption) · q (stop)');
process.stdin.setRawMode?.(true);
process.stdin.resume();
process.stdin.on('data', (d) => {
  const k = d.toString();
  if (k === '\u0003' || k === 'q') { marks.q ??= at(); rec.stdin.write('q'); return; }
  if (['f', 'n', 'c'].includes(k)) { marks[k] = at(); console.log(`[rec] ${k} at ${marks[k].toFixed(1)} s`); }
});
rec.on('exit', async () => {
  process.stdin.setRawMode?.(false);
  process.stdin.pause();
  const c = marks.c ?? marks.q ?? at();
  const f = marks.f;
  const n = marks.n !== undefined && f !== undefined && marks.n > f ? marks.n : undefined;
  const end = Math.min(c + 3, marks.q ?? at());
  // trim to the useful stretch; the installer's progress (f → n) at ×4
  const parts: string[] = [];
  const filters: string[] = [];
  const cut = (a: number, b: number, i: number, fast: boolean) => {
    filters.push(`[0:v]trim=start=${a.toFixed(2)}:end=${b.toFixed(2)},setpts=${fast ? `(PTS-STARTPTS)/${SPEED}` : 'PTS-STARTPTS'}[v${i}]`);
    parts.push(`[v${i}]`);
  };
  if (f !== undefined && n !== undefined) { cut(0, f, 0, false); cut(f, n, 1, true); cut(n, end, 2, false); } else cut(0, end, 0, false);
  filters.push(`${parts.join('')}concat=n=${parts.length}:v=1:a=0,fps=25,format=yuv420p[out]`);
  await new Promise<void>((resolve, reject) => {
    const p = spawn(ffmpegPath as unknown as string, ['-hide_banner', '-loglevel', 'error', '-y', '-i', raw, '-filter_complex', filters.join(';'), '-map', '[out]', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', OUT], { stdio: ['ignore', 'inherit', 'inherit'] });
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited with ${code}`))));
  });
  const saved = f !== undefined && n !== undefined ? (n - f) * (1 - 1 / SPEED) : 0;
  const meta = { seconds: Math.round(c * 10) / 10, secondsInVideo: Math.round((c - saved) * 10) / 10, fast: f !== undefined && n !== undefined ? { from: f, to: f + (n - f) / SPEED, factor: SPEED } : null, marks };
  fs.writeFileSync(OUT.replace(/\.mp4$/, '.json'), JSON.stringify(meta, null, 2));
  fs.rmSync(raw, { force: true });
  console.log(`[rec] wrote ${path.relative('.', OUT)} · from double-click to captions: ${meta.seconds} s (${meta.secondsInVideo} s in the video)`);
  process.exit(0);
});
