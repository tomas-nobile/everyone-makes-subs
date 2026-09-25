// Word-level alignment used for dedupe. Comparison is on normalized words (lowercase, no accents,
// no punctuation); callers always publish the original words.

export function norm(word: string): string {
  return word.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

export function words(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

/** Normalized words, dropping tokens that were only punctuation. */
export function normWords(ws: string[]): string[] {
  return ws.map(norm).filter(Boolean);
}

/**
 * Index j into `final` (original words) such that final[0..j) is the part already committed.
 * Uses word edit distance on normalized words and accepts up to 20% of the committed length.
 * If nothing aligns, falls back to cutting by the committed word count.
 */
export function stripIndex(committed: string[], final: string[]): number {
  // Map normalized positions back to original indices (punctuation-only tokens are skipped).
  const idx: number[] = [];
  const f: string[] = [];
  final.forEach((w, i) => { const n = norm(w); if (n) { f.push(n); idx.push(i); } });
  const c = normWords(committed);
  if (c.length === 0) return 0;
  // DP: d[j] = edit distance between all of c and f[0..j)
  let prev = Array.from({ length: f.length + 1 }, (_, j) => j);
  for (let i = 1; i <= c.length; i++) {
    const cur = [i];
    for (let j = 1; j <= f.length; j++) {
      const sub = prev[j - 1] + (c[i - 1] === f[j - 1] ? 0 : 1);
      cur.push(Math.min(sub, prev[j] + 1, cur[j - 1] + 1));
    }
    prev = cur;
  }
  let best = -1;
  let bestD = Infinity;
  for (let j = 0; j <= f.length; j++) {
    if (prev[j] < bestD) { bestD = prev[j]; best = j; }
  }
  if (bestD > Math.max(1, Math.floor(c.length * 0.2))) best = Math.min(c.length, f.length);
  return best >= f.length ? final.length : idx[best];
}

/** Only the new part of `final`, given the text already committed in this utterance. */
export function stripCommitted(committed: string, final: string): string {
  const fw = words(final);
  return fw.slice(stripIndex(words(committed), fw)).join(' ');
}

/**
 * After a session swap with audio overlap, the new session repeats the tail of the previous one.
 * Removes the longest prefix of `next` that matches a suffix of `prev` (≤20% mismatched words).
 */
export function trimOverlap(prev: string, next: string): string {
  const p = normWords(words(prev));
  const nw = words(next);
  const n: string[] = [];
  const idx: number[] = [];
  nw.forEach((w, i) => { const x = norm(w); if (x) { n.push(x); idx.push(i); } });
  const max = Math.min(p.length, n.length, 40);
  for (let k = max; k >= 2; k--) {
    let miss = 0;
    for (let i = 0; i < k; i++) if (p[p.length - k + i] !== n[i]) miss++;
    if (miss <= Math.floor(k * 0.2) && p[p.length - 1] === n[k - 1]) {
      return k >= n.length ? '' : nw.slice(idx[k]).join(' ');
    }
  }
  return next;
}
