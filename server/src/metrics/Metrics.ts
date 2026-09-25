import type { Segment, VocabCount } from '../../../shared/contract.js';
import { norm } from '../seg/align.js';

// Cost estimate (US$). Rough list prices; shown only inside "Technical details".
export const ASR_USD_PER_MIN = 0.005;
export const MT_USD_PER_SEGMENT = 0.00005;

/** Per-stage counters fed from the bus and the worker (docs/architecture.md → "Metrics"). */
export class StageStats {
  level = 0;
  lastLine = '';
  liveLine = '';
  http429 = 0;
  segmentsThisHour: number[] = [];
  noAudioSince: number | null = null;
  startedAt = Date.now();
  private delays: Array<{ seg: number; tr: number | null; seq: number }> = [];
  private errors: number[] = [];
  private vocab = new Map<string, number>();
  private vocabTerms: string[] = [];

  onSegment(seq: number, text: string, lag: number | undefined): void {
    this.lastLine = text;
    this.liveLine = '';
    this.delays.push({ seq, seg: lag ?? 0, tr: null });
    if (this.delays.length > 50) this.delays.shift();
    const now = Date.now();
    this.segmentsThisHour.push(now);
    while (this.segmentsThisHour.length && this.segmentsThisHour[0] < now - 3_600_000) this.segmentsThisHour.shift();
    this.countVocab(text);
  }

  onTr(seq: number, ms: number): void {
    const d = this.delays.find((x) => x.seq === seq);
    if (d) d.tr = d.seg + ms / 1000;
  }

  /**
   * A 429 that another model absorbed is quota, not a failure: it only counts in "Technical details".
   * Errors (the alert) are what reached the audience: a session drop or a translation left null.
   */
  onError(status: number): void {
    if (status === 429) { this.http429++; return; }
    this.errors.push(Date.now());
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

  costPerHour(sentSec: number): number {
    const elapsedH = Math.max(1 / 60, (Date.now() - this.startedAt) / 3_600_000);
    const asrMinPerHour = sentSec / 60 / elapsedH;
    const segPerHour = this.segmentsThisHour.length / Math.min(1, elapsedH);
    return Math.round((asrMinPerHour * ASR_USD_PER_MIN + segPerHour * MT_USD_PER_SEGMENT) * 100) / 100;
  }
}

function pct(xs: number[], p: number): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.floor(s.length * p))] * 10) / 10;
}
