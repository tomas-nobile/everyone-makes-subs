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
  onCommit: (c: Commit) => void;
  replacements?: () => Record<string, string>;
  now?: () => number;
}

/**
 * Cuts the ASR stream into readable phrases (docs/architecture.md → "4. Segmenter").
 * onInterim receives the accumulated text of the current utterance; onFinal closes it.
 */
export class Segmenter {
  private prevNorm: string[] = [];
  private committed: string[] = [];     // original words committed in this utterance
  private lastCommitAt = 0;
  private recent: string[] = [];        // last published texts (noise: 3 identical in a row)
  private now: () => number;

  constructor(private opts: SegmenterOptions) {
    this.now = opts.now ?? Date.now;
  }

  onInterim(text: string): void {
    const cur = words(text);
    const curNorm = cur.map(norm);
    if (this.committed.length === 0 && this.prevNorm.length === 0) this.lastCommitAt = this.now();
    // LocalAgreement-2: the common word prefix of the last two interims is stable.
    let stable = 0;
    while (stable < curNorm.length && stable < this.prevNorm.length && curNorm[stable] === this.prevNorm[stable]) stable++;
    this.prevNorm = curNorm;
    if (stable <= this.committed.length) return;

    const pend = cur.slice(this.committed.length, stable);
    let cut = 0;
    // 1. ends a sentence with 5+ words (the last sentence end in the pending text)
    for (let i = pend.length - 1; i >= 4; i--) if (SENTENCE_END.test(pend[i])) { cut = i + 1; break; }
    // 2. 8+ words with a comma (cut after it) or a conjunction (cut before it)
    if (!cut && pend.length >= 8) {
      for (let i = pend.length - 1; i >= 3; i--) {
        if (COMMA.test(pend[i]) && i < pend.length - 1) { cut = i + 1; break; }
        if (CONJUNCTIONS.has(norm(pend[i]))) { cut = i; break; }
      }
    }
    // 3. too long without a commit
    if (!cut && pend.length >= 4 && this.now() - this.lastCommitAt > this.opts.forceCommitMs) cut = pend.length;
    if (cut) this.commit(pend.slice(0, cut));
  }

  onFinal(text: string): void {
    const fw = words(text);
    const rest = fw.slice(stripIndex(this.committed, fw));
    this.committed = [];
    this.prevNorm = [];
    if (rest.length) this.publish(rest.join(' '));
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

export function applyReplacements(text: string, replacements: Record<string, string>): string {
  let out = text;
  for (const [from, to] of Object.entries(replacements)) {
    if (!from.trim()) continue;
    const esc = from.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}])${esc}(?![\\p{L}\\p{N}])`, 'giu'), to);
  }
  return out;
}
