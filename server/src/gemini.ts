import { GoogleGenAI, ThinkingLevel } from '@google/genai';

// One client per key: the key can change at runtime from the setup wizard.
let client: GoogleGenAI | undefined;
let clientKey = '';
// Models that just answered 429 (quota) or 404/400 (not available to this key) are skipped until then.
const coolingUntil = new Map<string, number>();

export function genai(apiKey: string): GoogleGenAI {
  if (!apiKey) throw new Error('No Gemini API key configured');
  if (!client || clientKey !== apiKey) {
    client = new GoogleGenAI({ apiKey });
    clientKey = apiKey;
    coolingUntil.clear();
  }
  return client;
}

/** HTTP-ish status of a Gemini SDK error (429, 403, 500…), or 0 if unknown. */
export function errorStatus(err: unknown): number {
  const e = err as { status?: number; code?: number; message?: string };
  if (typeof e?.status === 'number') return e.status;
  if (typeof e?.code === 'number') return e.code;
  const m = /"code":\s*(\d{3})|\b(4\d\d|5\d\d)\b/.exec(String(e?.message ?? ''));
  return m ? Number(m[1] ?? m[2]) : 0;
}

/** The server's "retry in N s" hint on a 429 (quota), in ms. */
export function retryDelayMs(err: unknown): number {
  const m = /retryDelay"?:\s*"?(\d+(?:\.\d+)?)s|retry in (\d+(?:\.\d+)?)\s*s/i.exec(String((err as Error)?.message ?? ''));
  return m ? Math.ceil(Number(m[1] ?? m[2]) * 1000) : 30_000;
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Retries 5xx/network errors with backoff 1-2-4 s (3 attempts). 4xx fail at once: a 429 is a
 * quota, and waiting seconds for it only delays the caption — the caller moves to another model.
 * `onError` sees every failure (for the errors-per-minute metric).
 */
export async function withRetry<T>(fn: () => Promise<T>, onError?: (status: number) => void): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      const status = errorStatus(err);
      onError?.(status);
      const retryable = status === 0 || status >= 500;
      if (!retryable || attempt === 2) break;
      await sleep(1000 * 2 ** attempt);
    }
  }
  throw last;
}

/** Gemini 3.x takes a thinking *level* (MINIMAL); 2.x takes a thinking *budget* (0 = off). */
function noThinking(model: string) {
  return /gemini-[3-9]/.test(model) ? { thinkingLevel: ThinkingLevel.MINIMAL } : { thinkingBudget: 0 };
}

export interface JsonOptions {
  schema?: object;
  temperature?: number;
  thinking?: boolean;
  /** Streams the response and reports the accumulated text after every chunk (F17.4: publish `es` as soon as it closes). */
  onText?: (accumulated: string) => void;
  /** Token usage of the call (F19.3 cost measurement). */
  onUsage?: (u: { model: string; input: number; output: number }) => void;
}

/** generateContent with JSON output; returns the parsed object. Streams when `onText` is given. */
export async function generateJson<T>(apiKey: string, model: string, prompt: string, opts: JsonOptions = {}): Promise<T> {
  const req = {
    model,
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      ...(opts.schema ? { responseSchema: opts.schema } : {}),
      temperature: opts.temperature ?? 0.2,
      ...(opts.thinking ? {} : { thinkingConfig: noThinking(model) }),
    },
  };
  let text = '';
  let usage: { promptTokenCount?: number; candidatesTokenCount?: number } | undefined;
  if (opts.onText) {
    for await (const chunk of await genai(apiKey).models.generateContentStream(req)) {
      const t = chunk.text;
      if (t) { text += t; opts.onText(text); }
      if (chunk.usageMetadata) usage = chunk.usageMetadata;
    }
  } else {
    const res = await genai(apiKey).models.generateContent(req);
    text = res.text ?? '';
    usage = res.usageMetadata;
  }
  if (usage && opts.onUsage) opts.onUsage({ model, input: usage.promptTokenCount ?? 0, output: usage.candidatesTokenCount ?? 0 });
  return JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, '')) as T;
}

export function modelCooling(model: string): boolean {
  return (coolingUntil.get(model) ?? 0) > Date.now();
}

/**
 * Tries each model in order (skipping the ones cooling down) and returns the first answer.
 * Quotas are per model, so on the free tier a second model doubles the capacity.
 */
export async function generateJsonWithFallback<T>(
  apiKey: string, models: string[], prompt: string,
  opts: JsonOptions & { maxWaitMs?: number } = {}, onError?: (status: number) => void,
): Promise<{ value: T; model: string }> {
  const list = [...new Set(models.filter(Boolean))];
  // every model out of quota: wait for the first one to recover when the caller can afford it
  const soonest = Math.min(...list.map((m) => coolingUntil.get(m) ?? 0)) - Date.now();
  if (soonest > 0 && soonest <= (opts.maxWaitMs ?? 0)) await sleep(soonest);
  const ready = list.filter((m) => !modelCooling(m));
  // everything cooling: try the one that recovers first rather than failing without trying
  const order = ready.length ? ready : [...list].sort((a, b) => (coolingUntil.get(a) ?? 0) - (coolingUntil.get(b) ?? 0)).slice(0, 1);
  let last: unknown;
  for (const model of order) {
    try {
      return { value: await withRetry(() => generateJson<T>(apiKey, model, prompt, opts), onError), model };
    } catch (err) {
      last = err;
      const status = errorStatus(err);
      if (status === 429) coolingUntil.set(model, Date.now() + retryDelayMs(err));
      else if (status === 404 || status === 400 || status === 403) coolingUntil.set(model, Date.now() + 10 * 60_000);
      const quota = /quotaId"?:\s*"?([\w-]+)[\s\S]*?quotaValue"?:\s*"?(\d+)/.exec(String((err as Error).message));
      console.log(`[gemini] ${model} failed (${status || (err as Error).message.slice(0, 80)}${quota ? ` · ${quota[1]} = ${quota[2]}` : ''})${model !== order.at(-1) ? ', trying the next model' : ''}`);
    }
  }
  throw last ?? new Error('no model available');
}
