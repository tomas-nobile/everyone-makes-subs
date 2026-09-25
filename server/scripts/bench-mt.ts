// Translation latency per model with the real prompt (F04.3 / F17.5): English → Spanish (+pt), the reference pair.
// Reports the whole call and, with TRANSLATE_STREAM=1 (default), the time until the `es` value closed.
// Usage: npx tsx server/scripts/bench-mt.ts [model …]   (KEEP_ALIVE=0 to measure without the keep-alive dispatcher)
import { loadConfig } from '../src/config.js';
import { KEEP_ALIVE } from '../src/gemini.js';
import { Translator } from '../src/mt/Translator.js';

try { process.loadEnvFile(); } catch { /* no .env */ }
const base = loadConfig();
// phrases as the segmenter cuts them from samples/en.mp3 ("Model Context Protocol in Plain English")
const PHRASES = [
  'So what is the Model Context Protocol, and why does everyone keep talking about it?',
  'If you ask ChatGPT what the weather is going to be tomorrow,',
  "you'll get a very different answer than if you ask the API.",
  'An AI application is a model plus tools plus some way to call them.',
  'MCP standardizes how a client talks to a server that exposes tools and resources.',
  'Authorization uses OAuth, so the server never sees your password.',
];
const models = process.argv.slice(2).length ? process.argv.slice(2) : [base.translateModel, base.translateFallbackModel];
console.log(`keep-alive ${KEEP_ALIVE ? 'on' : 'off'} · stream ${base.translateStream ? 'on' : 'off'} · concurrency ${base.translateConcurrency}`);
for (const model of models) {
  const cfg = { ...base, translateModel: model, translateFallbackModel: model };
  const tr = new Translator('bench', cfg, () => ({ id: 't', stageId: 's', title: 'Model Context Protocol in Plain English', lang: 'en', status: 'live', glossary: { asrVocabulary: [], doNotTranslate: ['MCP', 'API', 'OAuth', 'ChatGPT'], preferred: {}, replacements: {} } }), () => ['es', 'en', 'pt'], () => {});
  const ms: number[] = [];
  const esMs: number[] = [];
  let nulls = 0;
  for (const p of PHRASES) {
    const r = await tr.translate(p, 'en', (partial) => esMs.push(partial.ms));
    ms.push(r.ms);
    if (Object.values(r.tr).includes(null)) nulls++;
    if (model === models[0] && ms.length === 3) console.log(`   e.g. "${p}" → es: ${r.tr.es} · pt: ${r.tr.pt}`);
  }
  ms.sort((a, b) => a - b);
  esMs.sort((a, b) => a - b);
  const p50 = (xs: number[]) => xs[Math.floor(xs.length / 2)] ?? NaN;
  console.log(`${model}: whole call p50 ${p50(ms)} ms · min ${ms[0]} · max ${ms.at(-1)} · es closed p50 ${p50(esMs)} ms (${esMs.length} partials) · nulls ${nulls}`);
}
