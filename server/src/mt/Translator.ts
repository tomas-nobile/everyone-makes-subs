import { Type } from '@google/genai';
import type { Talk } from '../../../shared/contract.js';
import type { Config } from '../config.js';
import { errorStatus, generateJsonWithFallback } from '../gemini.js';

const LANG_NAMES: Record<string, string> = { es: 'Spanish', en: 'English', pt: 'Portuguese', fr: 'French', de: 'German', it: 'Italian' };
const CONCURRENCY = 2;
const MAX_BATCH = 6;
const QUOTA_WAIT_MS = 10_000;

export interface TranslateResult { src: string; tr: Record<string, string | null>; ms: number }
/** F17.4: the Spanish value, published as soon as it closes in the streamed JSON (before the other languages). */
export type PartialHandler = (partial: { tr: Record<string, string>; ms: number }) => void;

interface Job { text: string; srcHint?: string; context: string[]; enqueued: number; done: (r: TranslateResult) => void; onPartial?: PartialHandler }

// Streamed JSON: the `es` value is complete once its closing quote is followed by a comma or brace.
const ES_VALUE = /"es"\s*:\s*"((?:[^"\\]|\\.)*)"\s*[,}]/;

/**
 * One TRANSLATE_MODEL call per committed segment, JSON with every target language
 * (docs/architecture.md → "5. Translator"). Concurrency 2 per stage. When segments pile up behind
 * busy calls (fast speaker, free-tier quota), the next call takes up to 6 of them at once.
 * 5xx → backoff 1-2-4 s; 429 → TRANSLATE_FALLBACK_MODEL (waiting ≤ 10 s if both are out of quota)
 * → null for the languages that could not be translated.
 * Spanish first (F17.4): `es` leads the schema's propertyOrdering and the call is streamed, so the
 * `es` value is published the moment it closes; the other languages follow in the same call.
 */
export class Translator {
  private context: string[] = [];
  private running = 0;
  private queue: Job[] = [];

  constructor(
    private label: string,
    private cfg: Config,
    private getTalk: () => Talk | null,
    private targetLangs: () => string[],
    private onError: (status: number) => void,
  ) {}

  translate(text: string, srcHint?: string, onPartial?: PartialHandler): Promise<TranslateResult> {
    const context = this.context.slice(-3);
    this.context.push(text);
    if (this.context.length > 3) this.context.shift();
    return new Promise((done) => {
      this.queue.push({ text, srcHint, context, enqueued: Date.now(), done, onPartial });
      this.pump();
    });
  }

  private pump(): void {
    while (this.running < CONCURRENCY && this.queue.length) {
      const batch = this.queue.splice(0, MAX_BATCH);
      this.running++;
      this.run(batch)
        .catch((err) => {
          console.log(`[${this.label}] translate crashed: ${(err as Error).message}`);
          for (const j of batch) j.done({ src: j.srcHint ?? '', tr: this.nulls(j), ms: Date.now() - j.enqueued });
        })
        .finally(() => { this.running--; this.pump(); });
    }
  }

  private nulls(j: Job): Record<string, string | null> {
    return Object.fromEntries(this.targetLangs().map((l) => [l, l === (j.srcHint || this.getTalk()?.lang) ? j.text : null]));
  }

  private async run(batch: Job[]): Promise<void> {
    const talk = this.getTalk();
    const src = batch[0].srcHint || talk?.lang || '';
    const langs = this.targetLangs();
    const todo = langs.filter((l) => l !== src);
    if (todo.length === 0) {
      for (const j of batch) j.done({ src, tr: Object.fromEntries(langs.map((l) => [l, j.text])), ms: Date.now() - j.enqueued });
      return;
    }

    const g = talk?.glossary;
    const many = batch.length > 1;
    const head = [
      `You are the live captioner for the talk "${talk?.title ?? 'a talk'}"${talk?.speaker ? ` (${talk.speaker})` : ''} at a technical conference.`,
      `Translate ${many ? 'each SEGMENT' : 'the SEGMENT'} into: ${todo.map((l) => `${l} (${LANG_NAMES[l] ?? l})`).join(', ')}. It may be a fragment of a sentence: translate only`,
      'what it says, without completing it. Subtitle style: short and faithful, add nothing.',
      'If the segment is already in a target language, return it unchanged in that language.',
      `DO NOT translate: ${JSON.stringify(g?.doNotTranslate ?? [])}. Required translations: ${JSON.stringify(g?.preferred ?? {})}.`,
      `CONTEXT (do not translate): ${JSON.stringify(batch[0].context)}`,
    ];
    // es first: its tokens are generated first, so Spanish costs the same as a dedicated call (F17.4)
    const order = [...(todo.includes('es') ? ['es'] : []), 'src', ...todo.filter((l) => l !== 'es')];
    const one = `{${order.map((k) => (k === 'src' ? '"src":"<iso 639-1 of the segment>"' : `"${k}":"..."`)).join(', ')}}`;
    const prompt = [
      ...head,
      ...(many ? batch.map((j, i) => `SEGMENT ${i + 1}: ${j.text}`) : [`SEGMENT: ${batch[0].text}`]),
      many ? `JSON: {"items":[${one}, …]} — one item per segment, in order` : `JSON: ${one}`,
    ].join('\n');
    const item = {
      type: Type.OBJECT,
      properties: Object.fromEntries(order.map((k) => [k, { type: Type.STRING }])),
      required: order,
      propertyOrdering: order,
    };
    const schema = many ? { type: Type.OBJECT, properties: { items: { type: Type.ARRAY, items: item } }, required: ['items'] } : item;

    // single segment with a Spanish target: stream and publish `es` the moment its value closes
    const job = batch[0];
    let esPublished = false;
    const onText = this.cfg.translateStream && !many && todo.includes('es') && job.onPartial ? (acc: string) => {
      if (esPublished) return;
      const m = ES_VALUE.exec(acc);
      if (!m) return;
      esPublished = true;
      try {
        const es = (JSON.parse(`"${m[1]}"`) as string).trim();
        if (es) job.onPartial?.({ tr: { es }, ms: Date.now() - job.enqueued });
      } catch { /* not a complete JSON string yet */ }
    } : undefined;

    // TRANSLATE_MODEL, then TRANSLATE_FALLBACK_MODEL (also while the first one is out of quota)
    let outs: Array<Record<string, string> | undefined> = [];
    try {
      const { value } = await generateJsonWithFallback<Record<string, string> | { items: Array<Record<string, string>> }>(
        this.cfg.geminiApiKey, [this.cfg.translateModel, this.cfg.translateFallbackModel], prompt,
        { schema, temperature: 0.2, maxWaitMs: QUOTA_WAIT_MS, onText }, (status) => { if (status === 429) this.onError(429); },
      );
      outs = many ? ((value as { items?: Array<Record<string, string>> }).items ?? []) : [value as Record<string, string>];
    } catch (err) {
      console.log(`[${this.label}] translation failed on every model (${errorStatus(err) || (err as Error).message.slice(0, 80)}); publishing null`);
      this.onError(0);   // the audience sees the original instead of a translation: a real error
    }
    batch.forEach((j, i) => {
      const out = outs[i];
      const tr: Record<string, string | null> = Object.fromEntries(langs.map((l) => [l, l === src ? j.text : null]));
      const detected = (out?.src ?? src).slice(0, 2).toLowerCase();
      for (const l of todo) tr[l] = typeof out?.[l] === 'string' && out[l].trim() ? out[l].trim() : null;
      if (detected && langs.includes(detected)) tr[detected] = j.text;   // the original, never a re-translation
      j.done({ src: detected || src, tr, ms: Date.now() - j.enqueued });
    });
    if (many) console.log(`[${this.label}] translated ${batch.length} segments in one call`);
  }
}
