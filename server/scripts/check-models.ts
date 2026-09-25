// Which configured models answer with this key, and why not (quota per minute/day, no access…).
// Usage: npx tsx server/scripts/check-models.ts [extra-model …]
import { loadConfig } from '../src/config.js';
import { generateJson } from '../src/gemini.js';

try { process.loadEnvFile(); } catch { /* no .env */ }
const cfg = loadConfig();
if (!cfg.geminiApiKey) { console.log('No Gemini key.'); process.exit(2); }
const models = [...new Set([cfg.translateModel, cfg.translateFallbackModel, cfg.auxModel, ...process.argv.slice(2)])];
for (const model of models) {
  const t = Date.now();
  try {
    const r = await generateJson<{ ok?: string }>(cfg.geminiApiKey, model, 'JSON: {"ok":"yes"}', { temperature: 0 });
    console.log(`${model}: OK in ${Date.now() - t} ms (${JSON.stringify(r).slice(0, 20)})`);
  } catch (e) {
    const m = String((e as Error).message).replace(/\s+/g, ' ');
    const why = m.match(/quotaId"?:\s*"?[\w-]+|quotaValue"?:\s*"?\d+|retryDelay"?:\s*"?[\w.]+|"status":\s*"\w+"|"code":\s*\d+/g)?.join(' · ');
    console.log(`${model}: ERROR ${why ?? m.slice(0, 200)}`);
  }
}
