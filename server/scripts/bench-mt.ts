// Translation latency per model with the real prompt (F04.3). Usage: npx tsx server/scripts/bench-mt.ts [model …]
import { loadConfig } from '../src/config.js';
import { Translator } from '../src/mt/Translator.js';

try { process.loadEnvFile(); } catch { /* no .env */ }
const base = loadConfig();
const PHRASES = [
  'que es una Eh, te da una calidad de vida para los',
  'que trabajamos con ellos y lo gestionamos.',
  '¿Qué pasa entonces? Que normalmente vamos a hablar eso, de clústeres.',
  'Clusters en los que tendremos nodos, en los',
  'que tendremos las apps contenerizadas y el control plane.',
  'Hoy no vamos a entrar en el control plane porque es un tema enorme',
];
const models = process.argv.slice(2).length ? process.argv.slice(2) : [base.translateModel, base.translateFallbackModel];
for (const model of models) {
  const cfg = { ...base, translateModel: model, translateFallbackModel: model };
  const tr = new Translator('bench', cfg, () => ({ id: 't', stageId: 's', title: 'Rendimiento en Kubernetes', lang: 'es', status: 'live', glossary: { asrVocabulary: [], doNotTranslate: ['Kubernetes', 'control plane', 'clusters'], preferred: {}, replacements: {} } }), () => cfg.targetLangs, () => {});
  const ms: number[] = [];
  let nulls = 0;
  for (const p of PHRASES) {
    const r = await tr.translate(p, 'es');
    ms.push(r.ms);
    if (Object.values(r.tr).includes(null)) nulls++;
    if (model === models[0] && ms.length === 3) console.log(`   e.g. "${p}" → en: ${r.tr.en} · pt: ${r.tr.pt}`);
  }
  ms.sort((a, b) => a - b);
  console.log(`${model}: p50 ${ms[Math.floor(ms.length / 2)]} ms · min ${ms[0]} · max ${ms.at(-1)} · nulls ${nulls}`);
}
