import { GoogleGenAI } from '@google/genai';

// One client per key: the key can change at runtime from the setup wizard.
let client: GoogleGenAI | undefined;
let clientKey = '';

export function genai(apiKey: string): GoogleGenAI {
  if (!apiKey) throw new Error('No Gemini API key configured');
  if (!client || clientKey !== apiKey) {
    client = new GoogleGenAI({ apiKey });
    clientKey = apiKey;
  }
  return client;
}

/** HTTP-ish status of a Gemini SDK error (429, 403, 500…), or 0 if unknown. */
export function errorStatus(err: unknown): number {
  const e = err as { status?: number; code?: number; message?: string };
  if (typeof e?.status === 'number') return e.status;
  if (typeof e?.code === 'number') return e.code;
  const m = /\b(4\d\d|5\d\d)\b/.exec(String(e?.message ?? ''));
  return m ? Number(m[1]) : 0;
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Retries 429/5xx/network errors with backoff 1-2-4 s (3 attempts). Other 4xx fail at once.
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
      const retryable = status === 0 || status === 429 || status >= 500;
      if (!retryable || attempt === 2) break;
      await sleep(1000 * 2 ** attempt);
    }
  }
  throw last;
}

/** generateContent with JSON output; returns the parsed object. */
export async function generateJson<T>(apiKey: string, model: string, prompt: string, opts: { schema?: object; temperature?: number; thinking?: boolean } = {}): Promise<T> {
  const res = await genai(apiKey).models.generateContent({
    model,
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      ...(opts.schema ? { responseSchema: opts.schema } : {}),
      temperature: opts.temperature ?? 0.2,
      ...(opts.thinking ? {} : { thinkingConfig: { thinkingBudget: 0 } }),
    },
  });
  const text = res.text ?? '';
  return JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, '')) as T;
}
