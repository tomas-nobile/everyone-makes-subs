// F04.3/F04.4 check: translates one segment with the configured key (or an invalid one) and prints
// the result and the time. Usage: npx tsx server/scripts/check-mt.ts ["text"] [--bad-key]
import { loadConfig } from '../src/config.js';
import { Translator } from '../src/mt/Translator.js';

try { process.loadEnvFile(); } catch { /* no .env */ }
const cfg = loadConfig();
if (process.argv.includes('--bad-key')) cfg.geminiApiKey = 'AIzaSy-invalid-key-for-testing-000000000';
const text = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'Hoy vamos a hablar de observabilidad con OpenTelemetry.';
let errors = 0;
const tr = new Translator('check', cfg, () => ({ id: 't', stageId: 's', title: 'Observabilidad sin dolor', lang: 'es', status: 'live', glossary: { asrVocabulary: [], doNotTranslate: ['OpenTelemetry'], preferred: {}, replacements: {} } }), () => cfg.targetLangs, () => errors++);
const res = await tr.translate(text, 'es');
console.log(JSON.stringify(res), `errors=${errors}`);
