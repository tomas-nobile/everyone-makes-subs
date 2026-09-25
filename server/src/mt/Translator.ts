import { Type } from '@google/genai';
import type { Talk } from '../../../shared/contract.js';
import type { Config } from '../config.js';
import { errorStatus, generateJson, withRetry } from '../gemini.js';

const LANG_NAMES: Record<string, string> = { es: 'Spanish', en: 'English', pt: 'Portuguese', fr: 'French', de: 'German', it: 'Italian' };

export interface TranslateResult { src: string; tr: Record<string, string | null>; ms: number }

/**
 * One TRANSLATE_MODEL call per committed segment, JSON with every target language
 * (docs/architecture.md → "5. Translator"). Concurrency 2 per stage. 429/5xx → backoff 1-2-4 s →
 * TRANSLATE_FALLBACK_MODEL → null for the languages that could not be translated.
 */
export class Translator {
  private context: string[] = [];
  private running = 0;
  private queue: Array<() => void> = [];

  constructor(
    private label: string,
    private cfg: Config,
    private getTalk: () => Talk | null,
    private targetLangs: () => string[],
    private onError: (status: number) => void,
  ) {}

  async translate(text: string, srcHint?: string): Promise<TranslateResult> {
    const context = this.context.slice(-3);
    this.context.push(text);
    if (this.context.length > 3) this.context.shift();
    await this.acquire();
    const started = Date.now();
    try {
      return { ...(await this.run(text, context, srcHint)), ms: Date.now() - started };
    } finally {
      this.release();
    }
  }

  private async run(text: string, context: string[], srcHint?: string): Promise<Omit<TranslateResult, 'ms'>> {
    const talk = this.getTalk();
    const src = srcHint || talk?.lang || '';
    const langs = this.targetLangs();
    const todo = langs.filter((l) => l !== src);
    const tr: Record<string, string | null> = {};
    for (const l of langs) tr[l] = l === src ? text : null;
    if (todo.length === 0) return { src, tr };

    const g = talk?.glossary;
    const prompt = [
      `You are the live captioner for the talk "${talk?.title ?? 'a talk'}"${talk?.speaker ? ` (${talk.speaker})` : ''} at a technical conference.`,
      `Translate the SEGMENT into: ${todo.map((l) => `${l} (${LANG_NAMES[l] ?? l})`).join(', ')}. It may be a fragment of a sentence: translate only`,
      'what it says, without completing it. Subtitle style: short and faithful, add nothing.',
      'If the segment is already in a target language, return it unchanged in that language.',
      `DO NOT translate: ${JSON.stringify(g?.doNotTranslate ?? [])}. Required translations: ${JSON.stringify(g?.preferred ?? {})}.`,
      `CONTEXT (do not translate): ${JSON.stringify(context)}`,
      `SEGMENT: ${text}`,
      `JSON: {"src":"<iso 639-1 of the segment>", ${todo.map((l) => `"${l}":"..."`).join(', ')}}`,
    ].join('\n');
    const schema = {
      type: Type.OBJECT,
      properties: Object.fromEntries([['src', { type: Type.STRING }], ...todo.map((l) => [l, { type: Type.STRING }])]),
      required: ['src', ...todo],
    };

    const call = (model: string) => generateJson<Record<string, string>>(this.cfg.geminiApiKey, model, prompt, { schema, temperature: 0.2 });
    let out: Record<string, string> | null = null;
    try {
      out = await withRetry(() => call(this.cfg.translateModel), this.onError);
    } catch (err) {
      console.log(`[${this.label}] translate failed on ${this.cfg.translateModel} (${errorStatus(err) || (err as Error).message}); trying ${this.cfg.translateFallbackModel}`);
      try {
        out = await call(this.cfg.translateFallbackModel);
      } catch (err2) {
        this.onError(errorStatus(err2));
        console.log(`[${this.label}] translate fallback failed (${errorStatus(err2) || (err2 as Error).message}); publishing null`);
      }
    }
    const detected = (out?.src ?? src).slice(0, 2).toLowerCase();
    for (const l of todo) tr[l] = typeof out?.[l] === 'string' && out[l].trim() ? out[l].trim() : null;
    if (detected && langs.includes(detected)) tr[detected] = text;   // the original, never a re-translation
    return { src: detected || src, tr };
  }

  private acquire(): Promise<void> {
    if (this.running < 2) { this.running++; return Promise.resolve(); }
    return new Promise((r) => this.queue.push(() => { this.running++; r(); }));
  }

  private release(): void {
    this.running--;
    this.queue.shift()?.();
  }
}
