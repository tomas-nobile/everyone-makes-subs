import type { SegmentKind } from '../../../shared/contract.js';
import { norm, stripIndex, words } from './align.js';

const SENTENCE_END = /[.?!;。？！]["')\]]*$/;
const COMMA = /[,:]["')\]]*$/;
const CONJUNCTIONS = new Set([
  'and', 'but', 'or', 'so', 'because', 'which', 'that', 'then',
  'y', 'e', 'pero', 'o', 'u', 'porque', 'entonces', 'que', 'aunque', 'cuando',
  'mas', 'ou', 'então', 'quando', 'embora',
]);
const SOUND = /^\s*[[(][^\])]{1,40}[\])]\s*$/;
const AUDIENCE = /\b(audience|público|publico|pregunta del público|plateia)\b/i;

export interface Commit { text: string; kind: SegmentKind }

export interface SegmenterOptions {
  forceCommitMs: number;
  /** F17.3: commit thresholds (defaults: sentence end with 5+ words, comma/conjunction with 8+, phrases ≤ 18 words). */
  sentenceMinWords?: number;
  commaMinWords?: number;
  maxPhraseWords?: number;
  onCommit: (c: Commit) => void;
  replacements?: () => Record<string, string>;
  now?: () => number;
}

export interface CutThresholds { sentenceMinWords: number; commaMinWords: number }
export const DEFAULT_THRESHOLDS = { sentenceMinWords: 5, commaMinWords: 8, maxPhraseWords: 18 };

/**
 * Cuts the ASR stream into readable phrases (docs/architecture.md → "4. Segmenter").
 * onInterim receives the accumulated text of the current utterance; onFinal closes it.
 */
export class Segmenter {
  private prevTail: string[] = [];      // normalized uncommitted words of the previous interim
  private committed: string[] = [];     // original words committed in this utterance
  private lastCommitAt = 0;
  private recent: string[] = [];        // last published texts (noise: 3 identical in a row)
  private now: () => number;
  private th: CutThresholds;
  private maxPhraseWords: number;

  constructor(private opts: SegmenterOptions) {
    this.now = opts.now ?? Date.now;
    this.th = { sentenceMinWords: opts.sentenceMinWords ?? DEFAULT_THRESHOLDS.sentenceMinWords, commaMinWords: opts.commaMinWords ?? DEFAULT_THRESHOLDS.commaMinWords };
    this.maxPhraseWords = opts.maxPhraseWords ?? DEFAULT_THRESHOLDS.maxPhraseWords;
  }

  /**
   * Where the uncommitted part starts in `cur`. The ASR keeps revising earlier words of a long
   * utterance ("clústeres." → "clusters."), so the committed words are located by alignment, not by
   * index: first by the last 3 committed words near the expected position, else by edit distance.
   */
  private tailStart(cur: string[]): number {
    const n = this.committed.length;
    if (n === 0) return 0;
    const curNorm = cur.map(norm);
    const anchor = this.committed.slice(-3).map(norm).filter(Boolean);
    if (anchor.length) {
      let best = -1;
      for (let i = Math.max(0, n - 15); i <= Math.min(cur.length - anchor.length, n + 15); i++) {
        if (anchor.every((w, k) => curNorm[i + k] === w) && (best < 0 || Math.abs(i + anchor.length - n) < Math.abs(best - n))) best = i + anchor.length;
      }
      if (best >= 0) return best;
    }
    return stripIndex(this.committed.slice(-40), cur.slice(Math.max(0, n - 60)), true) + Math.max(0, n - 60);
  }

  onInterim(text: string): void {
    const cur = words(text);
    if (this.committed.length === 0 && this.prevTail.length === 0) this.lastCommitAt = this.now();
    const tail = cur.slice(this.tailStart(cur));
    const tailNorm = tail.map(norm);
    // LocalAgreement-2 on the uncommitted part: the common prefix of the last two interims is stable.
    let stable = 0;
    while (stable < tailNorm.length && stable < this.prevTail.length && tailNorm[stable] === this.prevTail[stable]) stable++;
    this.prevTail = tailNorm;
    if (stable === 0) return;

    const pend = tail.slice(0, stable);
    const cut = cutPoint(pend, this.now() - this.lastCommitAt > this.opts.forceCommitMs, false, this.th);
    if (cut) {
      this.commit(pend.slice(0, cut));
      this.prevTail = this.prevTail.slice(cut);
    }
  }

  onFinal(text: string): void {
    const fw = words(text);
    let rest = this.committed.length ? fw.slice(this.tailStart(fw)) : fw;
    this.committed = [];
    this.prevTail = [];
    // a long final (a speaker who never paused) is published as readable phrases, not one block
    const max = this.maxPhraseWords;
    while (rest.length > max) {
      const cut = cutPoint(rest.slice(0, max + 4), true, true, this.th) || max;
      this.publish(rest.slice(0, cut).join(' '));
      rest = rest.slice(cut);
    }
    if (rest.length) this.publish(rest.join(' '));
  }

  /** How many words of the current utterance are already published (the live line shows the rest). */
  get committedCount(): number {
    return this.committed.length;
  }

  /** Words committed but the utterance is still open (for tests and the overlap trim). */
  get pendingCommitted(): string {
    return this.committed.join(' ');
  }

  private commit(ws: string[]): void {
    this.committed.push(...ws);
    this.lastCommitAt = this.now();
    this.publish(ws.join(' '));
  }

  private publish(raw: string): void {
    const text = applyReplacements(raw.trim(), this.opts.replacements?.() ?? {});
    if (!text || !/[\p{L}\p{N}]/u.test(text)) return;
    const n = words(text).map(norm).join(' ');
    if (this.recent.length >= 2 && this.recent.every((r) => r === n)) return;
    this.recent.push(n);
    if (this.recent.length > 2) this.recent.shift();
    const kind: SegmentKind = SOUND.test(text) ? (AUDIENCE.test(text) ? 'audience' : 'sound') : 'speech';
    this.opts.onCommit({ text, kind });
  }
}

/**
 * How many words of `pend` to commit (0 = wait): the last sentence end with `sentenceMinWords`+ words;
 * else, with `commaMinWords`+ words, the last comma (cut after) or conjunction (cut before); else
 * everything if `force` and 4+ words. `lenient` (splitting a long final) takes any sentence end or
 * comma after word 4.
 */
function cutPoint(pend: string[], force: boolean, lenient: boolean, th: CutThresholds): number {
  for (let i = pend.length - 1; i >= th.sentenceMinWords - 1; i--) if (SENTENCE_END.test(pend[i])) return i + 1;
  if (pend.length >= th.commaMinWords || lenient) {
    for (let i = pend.length - 1; i >= 3; i--) {
      if (COMMA.test(pend[i]) && i < pend.length - 1) return i + 1;
      if (CONJUNCTIONS.has(norm(pend[i]))) return i;
    }
  }
  // splitting a long final: no natural cut in the window → the caller cuts at exactly maxPhraseWords
  return force && !lenient && pend.length >= 4 ? pend.length : 0;
}

export function applyReplacements(text: string, replacements: Record<string, string>): string {
  let out = text;
  for (const [from, to] of Object.entries(replacements)) {
    if (!from.trim()) continue;
    const esc = from.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}])${esc}(?![\\p{L}\\p{N}])`, 'giu'), to);
  }
  return out;
}
