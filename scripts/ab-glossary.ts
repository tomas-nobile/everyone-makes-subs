// F16.4: A/B proof of the vocabulary. The same clip goes through the real pipeline twice — empty
// glossary, then the glossary Gemini builds from the talk's title/abstract — and the lines where a
// vocabulary term differs are written to demo/ab/ab.json (verbatim from the two runs' outputs).
// Usage: npm run ab -- [--clip=demo/clip.mp4 --src-lang=en --lang=es --title="…" --speaker="…" --abstract="…"]
import fs from 'node:fs';
import path from 'node:path';
import { emptyGlossary, type Segment } from '../shared/contract.js';
import { generateGlossary } from '../server/src/ai/auxModel.js';
import { loadConfig } from '../server/src/config.js';
import { runFile } from '../server/src/stage/runFile.js';
import { toTxt, toVtt } from '../server/src/store/export.js';

try { process.loadEnvFile(); } catch { /* no .env */ }
const cfg = loadConfig();
if (!cfg.geminiApiKey) { console.log('No Gemini key: put GEMINI_API_KEY in .env.'); process.exit(2); }
const opt = (n: string, d: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=') ?? d;
const clip = path.resolve(opt('clip', 'demo/clip.mp4'));
const srcLang = opt('src-lang', 'en');
const lang = opt('lang', 'es');
const meta = fs.existsSync(clip.replace(/\.mp4$/, '.transcript.json')) ? JSON.parse(fs.readFileSync(clip.replace(/\.mp4$/, '.transcript.json'), 'utf8')) as { title?: string; speaker?: string } : {};
const talk = { title: opt('title', meta.title ?? path.basename(clip)), speaker: opt('speaker', meta.speaker ?? ''), abstract: opt('abstract', ''), lang: srcLang };
const dir = 'demo/ab';
fs.mkdirSync(dir, { recursive: true });

const glossary = await generateGlossary(cfg, talk);
console.log(`[ab] glossary: ${glossary.asrVocabulary.length} terms · ${glossary.asrVocabulary.slice(0, 12).join(', ')}…`);
const langs = [...new Set([srcLang, lang])];
console.log('[ab] run A: empty glossary…');
const a = await runFile({ cfg, file: clip, label: 'ab-without', targetLangs: langs, talk: { ...talk, glossary: emptyGlossary() }, onLine: () => {} });
console.log(`[ab] ${a.segments.length} segments. run B: generated glossary…`);
const b = await runFile({ cfg, file: clip, label: 'ab-with', targetLangs: langs, talk: { ...talk, glossary }, onLine: () => {} });
console.log(`[ab] ${b.segments.length} segments.`);
for (const [name, r] of [['without', a], ['with', b]] as const) {
  fs.writeFileSync(path.join(dir, `${name}.txt`), toTxt(r.segments, undefined, talk.title));
  fs.writeFileSync(path.join(dir, `${name}.${lang}.txt`), toTxt(r.segments, lang, talk.title));
  fs.writeFileSync(path.join(dir, `${name}.${lang}.vtt`), toVtt(r.segments, lang));
}

// lines where a term appears in B and not in the overlapping line of A (original text), plus total hits
const norm = (s: string) => s.toLowerCase();
const hits = (segs: Segment[]) => glossary.asrVocabulary.reduce((n, t) => n + segs.filter((s) => norm(s.text).includes(norm(t))).length, 0);
const overlap = (x: Segment, y: Segment) => Math.min(x.t1, y.t1) - Math.max(x.t0, y.t0);
const lines: Array<{ term: string; without: string; with: string; withoutEs?: string | null; withEs?: string | null }> = [];
for (const term of glossary.asrVocabulary) {
  for (const sb of b.segments.filter((s) => norm(s.text).includes(norm(term)))) {
    const sa = [...a.segments].sort((x, y) => overlap(y, sb) - overlap(x, sb))[0];
    if (!sa || overlap(sa, sb) <= 0 || norm(sa.text).includes(norm(term))) continue;
    if (lines.some((l) => l.with === sb.text)) continue;
    lines.push({ term, without: sa.text, with: sb.text, withoutEs: sa.tr[lang], withEs: sb.tr[lang] });
  }
}
const out = { clip: path.relative('.', clip), title: talk.title, terms: glossary.asrVocabulary, hitsWithout: hits(a.segments), hitsWith: hits(b.segments), lines };
fs.writeFileSync(path.join(dir, 'ab.json'), JSON.stringify(out, null, 1));
console.log(`[ab] vocabulary hits: ${out.hitsWithout} without → ${out.hitsWith} with · ${lines.length} line(s) where a term differs`);
for (const l of lines.slice(0, 5)) console.log(`  ${l.term}: "${l.without}" → "${l.with}"`);
if (!lines.length) console.log('[ab] no line differs: the video shows the hit counts instead (log it in docs/decisions.md)');
process.exit(0);
