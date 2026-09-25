import type { Segment, VocabCount } from '../../../shared/contract.js';
import { norm } from '../seg/align.js';

// Cost (US$) at list prices (docs/pricing.json, 2026-09-24): audio minutes sent to the ASR and the
// translation tokens reported by `usageMetadata` (F19.3). Shown inside "Technical details".
export const ASR_USD_PER_MIN = 0.009;             // gemini-3.5-transcribe-live, Google's blended rate
export const MT_USD_PER_MTOKENS_IN = 0.3;         // gemini-3.5-flash-lite
export const MT_USD_PER_MTOKENS_OUT = 2.5;

/** Per-stage counters fed from the bus and the worker (docs/architecture.md → "Metrics"). */
export class StageStats {
  level = 0;
  lastLine = '';
  liveLine = '';
  http429 = 0;
  tokensIn = 0;
  tokensOut = 0;
  segmentsThisHour: number[] = [];
  noAudioSince: number | null = null;
  startedAt = Date.now();
  private delays: Array<{ seg: number; tr: number | null; seq: number }> = [];
  private errors: number[] = [];
  private vocab = new Map<string, number>();
  private vocabTerms: string[] = [];

  /** `lag` (pause → caption) only exists for phrases of an utterance closed by a pause (F17.6): the delay samples are those. */
  onSegment(seq: number, text: string, lag: number | undefined): void {
    this.lastLine = text;
    this.liveLine = '';
    if (lag !== undefined) this.delays.push({ seq, seg: lag, tr: null });
    if (this.delays.length > 50) this.delays.shift();
    const now = Date.now();
    this.segmentsThisHour.push(now);
    while (this.segmentsThisHour.length && this.segmentsThisHour[0] < now - 3_600_000) this.segmentsThisHour.shift();
    this.countVocab(text);
  }

  /** The first `tr` of a segment is the Spanish one (F17.4): that is the delay the attendee felt. */
  onTr(seq: number, ms: number): void {
    const d = this.delays.find((x) => x.seq === seq);
    if (d && d.tr === null) d.tr = d.seg + ms / 1000;
  }

  /**
   * A 429 that another model absorbed is quota, not a failure: it only counts in "Technical details".
   * Errors (the alert) are what reached the audience: a session drop or a translation left null.
   */
  onError(status: number): void {
    if (status === 429) { this.http429++; return; }
    this.errors.push(Date.now());
  }

  onUsage(u: { input: number; output: number }): void {
    this.tokensIn += u.input;
    this.tokensOut += u.output;
  }

  get errorsPerMin(): number {
    const cut = Date.now() - 60_000;
    this.errors = this.errors.filter((t) => t > cut);
    return this.errors.length;
  }

  delay(): { p50: number; p95: number; p50Tr: number; p95Tr: number } | null {
    if (this.delays.length === 0) return null;
    const seg = this.delays.map((d) => d.seg);
    const tr = this.delays.map((d) => d.tr).filter((x): x is number => x !== null);
    return { p50: pct(seg, 0.5), p95: pct(seg, 0.95), p50Tr: pct(tr, 0.5), p95Tr: pct(tr, 0.95) };
  }

  /** F10.4: occurrences of each asrVocabulary term in the current talk (case/accent-insensitive). */
  resetVocab(terms: string[], segments: Segment[]): void {
    this.vocabTerms = terms;
    this.vocab = new Map(terms.map((t) => [t, 0]));
    for (const s of segments) this.countVocab(s.text);
  }

  vocabCounts(): VocabCount[] {
    return this.vocabTerms.map((term) => ({ term, count: this.vocab.get(term) ?? 0 }));
  }

  private countVocab(text: string): void {
    if (!this.vocabTerms.length) return;
    const hay = ` ${text.split(/\s+/).map(norm).filter(Boolean).join(' ')} `;
    for (const term of this.vocabTerms) {
      const needle = term.split(/\s+/).map(norm).filter(Boolean).join(' ');
      if (!needle) continue;
      let i = 0;
      let n = 0;
      while ((i = hay.indexOf(` ${needle} `, i)) >= 0) { n++; i += needle.length + 1; }
      if (n) this.vocab.set(term, (this.vocab.get(term) ?? 0) + n);
    }
  }

  /** US$ spent so far at list prices: audio minutes + real translation tokens. */
  costSoFar(sentSec: number): number {
    return (sentSec / 60) * ASR_USD_PER_MIN + (this.tokensIn / 1e6) * MT_USD_PER_MTOKENS_IN + (this.tokensOut / 1e6) * MT_USD_PER_MTOKENS_OUT;
  }

  costPerHour(sentSec: number): number {
    const elapsedH = Math.max(1 / 60, (Date.now() - this.startedAt) / 3_600_000);
    return Math.round((this.costSoFar(sentSec) / elapsedH) * 100) / 100;
  }
}

function pct(xs: number[], p: number): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.floor(s.length * p))] * 10) / 10;
}
