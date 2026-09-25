// F18.1: how fast can a video job feed the Live API? Runs the real pipeline over a file at each speed
// (transcription only, no translation) and compares the words with the 1× run (LCS diff).
// Usage: npx tsx server/scripts/check-speed.ts <file> [--speeds=1,2,4] [--lang=en] [--seconds=0]
import { emptyGlossary } from '../../shared/contract.js';
import { loadConfig } from '../src/config.js';
import { runFile } from '../src/stage/runFile.js';

try { process.loadEnvFile(); } catch { /* no .env */ }
const cfg = loadConfig();
if (!cfg.geminiApiKey) { console.log('No Gemini key: put GEMINI_API_KEY in .env.'); process.exit(2); }
const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
if (!file) { console.log('Usage: npx tsx server/scripts/check-speed.ts <file> --speeds=1,2,4 --lang=en'); process.exit(2); }
const opt = (n: string, d: string) => args.find((a) => a.startsWith(`--${n}=`))?.split('=')[1] ?? d;
const speeds = opt('speeds', '1,2,4').split(',').map(Number);
const lang = opt('lang', 'en');
const seconds = Number(opt('seconds', '0'));

const norm = (t: string) => t.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}\s]/gu, '').split(/\s+/).filter(Boolean);
function lcs(a: string[], b: string[]): number {
  let prev = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    const cur = new Array<number>(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j++) cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    prev = cur;
  }
  return prev[b.length];
}

const results: Array<{ speed: number; words: string[]; segments: number; wallSec: number; rotations: number; errors: number }> = [];
for (const speed of speeds) {
  console.log(`[speed] ${speed}× …`);
  const t = Date.now();
  const r = await runFile({ cfg, file, label: `x${speed}`, speed, seconds, targetLangs: [lang], talk: { title: file, lang, glossary: emptyGlossary() }, onLine: () => {} });
  const words = norm(r.segments.map((s) => s.text).join(' '));
  results.push({ speed, words, segments: r.segments.length, wallSec: Math.round((Date.now() - t) / 1000), rotations: r.rotations, errors: r.errors });
  console.log(`[speed] ${speed}×: ${r.segments.length} segments, ${words.length} words, ${Math.round((Date.now() - t) / 1000)} s wall, ${r.rotations} rotations, ${r.errors} errors`);
}
const ref = results[0];
console.log(`\nspeed  words  wall   vs ${ref.speed}×: missing / extra (LCS)`);
for (const r of results) {
  const l = lcs(ref.words, r.words);
  console.log(`${String(r.speed).padStart(2)}×   ${String(r.words.length).padStart(5)}  ${String(r.wallSec).padStart(4)} s   ${ref.words.length - l} missing · ${r.words.length - l} extra`);
}
process.exit(0);
