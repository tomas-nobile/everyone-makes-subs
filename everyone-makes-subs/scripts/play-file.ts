// Plays a file or URL (YouTube or anything ffmpeg reads) as a real-time source and prints
// the clock, chunks and meter every second.
// Usage: npx tsx scripts/play-file.ts [file|url] [--loop] [--seconds=N]
import type { SourceSpec } from '../shared/contract.js';
import { Meter } from '../server/src/audio/meter.js';
import { AudioSource } from '../server/src/audio/sources.js';

const arg = process.argv[2] ?? 'samples/es.mp3';
const loop = process.argv.includes('--loop');
const seconds = Number(process.argv.find((a) => a.startsWith('--seconds='))?.split('=')[1] ?? 0);
const spec: SourceSpec = /^https?:\/\//.test(arg) ? { kind: 'url', url: arg } : { kind: 'file', path: arg, loop };
const src = new AudioSource(spec, 'play', process.env.DATA_DIR ?? './data');

const meter = new Meter();
let chunks = 0;
src.on('chunk', (c: Buffer) => {
  chunks++;
  meter.push(c);
});
src.on('end', () => {
  console.log(`end · clock ${src.clock.toFixed(2)} s · ${chunks} chunks`);
  process.exit(0);
});
src.on('state', (s: string) => console.log(`state ${s} · ffmpeg pid ${src.pid ?? '-'}`));

const t0 = Date.now();
src.start();
setInterval(() => {
  const wall = (Date.now() - t0) / 1000;
  console.log(`wall ${wall.toFixed(1)} s · clock ${src.clock.toFixed(2)} s · ${chunks} chunks · level ${meter.level.toFixed(2)} · ${meter.isSpeech ? 'speech' : `silent ${meter.silentForMs} ms`}`);
  if (seconds && wall >= seconds) {
    src.stop();
    console.log(`done · ${chunks} chunks in ${wall.toFixed(1)} s`);
    process.exit(0);
  }
}, 1000);
