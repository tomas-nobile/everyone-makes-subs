import { Type } from '@google/genai';
import type { AgendaProposal, Glossary, Segment, TalkInput } from '../../../shared/contract.js';
import { emptyGlossary } from '../../../shared/contract.js';
import { parseAgendaText } from '../agenda/parse.js';
import type { Config } from '../config.js';
import { generateJsonWithFallback } from '../gemini.js';

/** AUX_MODEL first; the translation models when it is out of quota (free tier: 20 requests/day). */
const auxModels = (cfg: Config) => [cfg.auxModel, cfg.translateModel, cfg.translateFallbackModel];

// AUX_MODEL calls: glossary per talk, agenda parsing and the "What did I miss?" summary.
// Each one has a fake twin (FAKE_BACKEND=1 or no key) so the whole flow works offline.

const useFake = (cfg: Config) => cfg.fakeBackend || !cfg.geminiApiKey;

// ── Glossary (F10.1) ──

/** Offline glossary: technical-looking tokens from the title/abstract + the speaker's name. */
export function fakeGlossary(t: TalkInput): Glossary {
  const text = `${t.title} ${t.abstract ?? ''} ${t.slidesText ?? ''}`;
  const terms = new Set<string>();
  for (const w of text.match(/[\p{L}\p{N}][\p{L}\p{N}+#.-]*[\p{L}\p{N}+#]/gu) ?? []) {
    const tech = /\p{Lu}.*\p{Lu}/u.test(w) || /\d/.test(w) && /\p{L}/u.test(w) || /^\p{Lu}\p{Ll}+\p{Lu}/u.test(w)
      || /^(Kubernetes|Postgres|Rust|Go|Python|Linux|Docker|React|Node|WebAssembly|Kafka|Redis|Gemini)$/i.test(w);
    if (tech) terms.add(w.replace(/[.-]+$/, ''));
  }
  for (const m of text.matchAll(/\b(tail-based sampling|trace ID|service mesh|edge AI|machine learning)\b/gi)) terms.add(m[0]);
  if (t.speaker) terms.add(t.speaker);
  const asrVocabulary = [...terms].slice(0, 100);
  return {
    asrVocabulary,
    doNotTranslate: asrVocabulary.filter((x) => x !== t.speaker),
    preferred: {},
    replacements: {},
  };
}

const GLOSSARY_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    asrVocabulary: { type: Type.ARRAY, items: { type: Type.STRING } },
    doNotTranslate: { type: Type.ARRAY, items: { type: Type.STRING } },
    preferred: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { term: { type: Type.STRING }, es: { type: Type.STRING }, en: { type: Type.STRING }, pt: { type: Type.STRING } }, required: ['term'] } },
    replacements: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { from: { type: Type.STRING }, to: { type: Type.STRING } }, required: ['from', 'to'] } },
  },
  required: ['asrVocabulary', 'doNotTranslate', 'preferred', 'replacements'],
};

export async function generateGlossary(cfg: Config, t: TalkInput): Promise<Glossary> {
  if (useFake(cfg)) return fakeGlossary(t);
  const prompt = `You prepare live captioning for a talk at a technical conference.
Talk: ${JSON.stringify({ title: t.title, speaker: t.speaker, abstract: t.abstract, lang: t.lang, slides: t.slidesText?.slice(0, 6000) })}
Return JSON:
- asrVocabulary: up to 100 terms the speech recognizer must get right (product names, acronyms, tools, people, jargon likely to be SAID in this talk, including related terms not in the abstract).
- doNotTranslate: terms that stay as-is in every language (product names, code identifiers, English jargon used by Spanish/Portuguese devs).
- preferred: required translations for ambiguous terms, as {term, es, en, pt}.
- replacements: likely misrecognitions → correct spelling, as {from, to} (e.g. "cubernetes" → "Kubernetes", "open telemetri" → "OpenTelemetry").`;
  try {
    const { value: out } = await generateJsonWithFallback<{ asrVocabulary: string[]; doNotTranslate: string[]; preferred: Array<{ term: string; es?: string; en?: string; pt?: string }>; replacements: Array<{ from: string; to: string }> }>(cfg.geminiApiKey, auxModels(cfg), prompt, { schema: GLOSSARY_SCHEMA, temperature: 0.3 });
    const g = emptyGlossary();
    g.asrVocabulary = [...new Set(out.asrVocabulary ?? [])].slice(0, 100);
    g.doNotTranslate = out.doNotTranslate ?? [];
    for (const p of out.preferred ?? []) {
      const { term, ...langs } = p;
      if (term) g.preferred[term] = Object.fromEntries(Object.entries(langs).filter(([, v]) => v)) as Record<string, string>;
    }
    for (const r of out.replacements ?? []) if (r.from && r.to) g.replacements[r.from] = r.to;
    return g;
  } catch (err) {
    console.log(`[glossary] AUX model failed (${(err as Error).message}); using the offline glossary`);
    return fakeGlossary(t);
  }
}

// ── Agenda (F10.2) ──

const AGENDA_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    rooms: { type: Type.ARRAY, items: { type: Type.STRING } },
    talks: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          room: { type: Type.STRING }, start: { type: Type.STRING }, end: { type: Type.STRING }, title: { type: Type.STRING },
          speaker: { type: Type.STRING }, abstract: { type: Type.STRING }, lang: { type: Type.STRING },
        },
        required: ['room', 'title'],
      },
    },
  },
  required: ['rooms', 'talks'],
};

export async function parseAgenda(cfg: Config, text: string): Promise<AgendaProposal> {
  if (useFake(cfg)) return parseAgendaText(text);
  const prompt = `Turn this conference schedule, pasted from the event website, into rooms and talks.
Times as "HH:MM" (24 h). If a talk has no end time, use the next talk's start in the same room.
lang = ISO 639-1 of the language the talk will be GIVEN in (from hints like "(in English)", else from the title language).
Keep titles and names exactly as written. Room names as written (title case).
SCHEDULE:
${text.slice(0, 30000)}`;
  try {
    return (await generateJsonWithFallback<AgendaProposal>(cfg.geminiApiKey, auxModels(cfg), prompt, { schema: AGENDA_SCHEMA, temperature: 0.1 })).value;
  } catch (err) {
    console.log(`[agenda] AUX model failed (${(err as Error).message}); using the offline parser`);
    return parseAgendaText(text);
  }
}

// ── Summary (F13.2) ──

export async function summarize(cfg: Config, title: string, segments: Segment[], langs: string[]): Promise<Record<string, string[]>> {
  if (useFake(cfg)) {
    const lines = segments.filter((s) => s.kind === 'speech').slice(-5);
    return Object.fromEntries(langs.map((l) => [l, lines.map((s) => s.tr[l] ?? s.text)]));
  }
  const transcript = segments.filter((s) => s.kind === 'speech').map((s) => s.text).join(' ');
  const schema = { type: Type.OBJECT, properties: Object.fromEntries(langs.map((l) => [l, { type: Type.ARRAY, items: { type: Type.STRING } }])), required: langs };
  const prompt = `Live talk "${title}". Summarize the LAST 5 MINUTES below in 3–5 short bullets for someone who just arrived: what was said, concretely (numbers, names, tools). No intro, no filler.
Write the bullets in each of: ${langs.join(', ')}.
TRANSCRIPT:
${transcript.slice(-12000)}`;
  return (await generateJsonWithFallback<Record<string, string[]>>(cfg.geminiApiKey, auxModels(cfg), prompt, { schema, temperature: 0.3 })).value;
}

/** Setup "Test" (F11.1): a minimal translation; throws with a plain-language code. */
export async function testKey(cfg: Config, key: string): Promise<void> {
  await generateJsonWithFallback(key, [cfg.translateModel, cfg.translateFallbackModel], 'Translate "hello" to Spanish. JSON: {"es":"..."}', { temperature: 0 });
}
