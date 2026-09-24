// Plays an audio file as a real-time source and prints the clock every second.
// Usage: npx tsx scripts/play-file.ts [file] [--loop]
import { Meter } from '../server/src/audio/meter.js';
import { AudioSource } from '../server/src/audio/sources.js';

const file = process.argv[2] ?? 'samples/es.mp3';
const loop = process.argv.includes('--loop');
const src = new AudioSource({ kind: 'file', path: file, loop }, 'play');

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

const t0 = Date.now();
src.start();
setInterval(() => {
  const wall = (Date.now() - t0) / 1000;
  console.log(`wall ${wall.toFixed(1)} s · clock ${src.clock.toFixed(2)} s · ${chunks} chunks · level ${meter.level.toFixed(2)} · ${meter.isSpeech ? 'speech' : `silent ${meter.silentForMs} ms`}`);
}, 1000);
