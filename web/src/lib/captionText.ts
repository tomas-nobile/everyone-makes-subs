// Small text-shaping helpers shared by the caption surfaces (phone, TV, overlay).

/** Tail of `t` cut at a word boundary, at most `n` characters. Used for TV/overlay line budgets. */
export function tail(t: string, n: number): string {
  if (t.length <= n) return t;
  const cut = t.slice(t.length - n);
  const i = cut.indexOf(' ');
  return '…' + (i >= 0 ? cut.slice(i + 1) : cut);
}

/** Hides the last (unstable) word of an interim/live line — it's the one most likely to still change. */
export function maskLive(text: string): { allMasked: true; text: string } | { allMasked: false; stable: string } {
  const words = text.split(' ');
  if (words.length < 3) return { allMasked: true, text };
  return { allMasked: false, stable: words.slice(0, -1).join(' ') };
}
