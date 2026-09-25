import type { Segment } from '../../../shared/contract.js';

const LINE = 42;
const CUE_CHARS = LINE * 2;

export interface Cue { start: number; end: number; lines: string[] }

/** Greedy wrap at word boundaries; a word longer than `width` stays whole. */
export function wrap(text: string, width = LINE): string[] {
  const out: string[] = [];
  let cur = '';
  for (const w of text.split(/\s+/).filter(Boolean)) {
    if (cur && cur.length + 1 + w.length > width) { out.push(cur); cur = w; } else cur = cur ? `${cur} ${w}` : w;
  }
  if (cur) out.push(cur);
  return out;
}

/** Text of a segment in `lang` (original when lang is empty or the translation failed). */
export function segText(s: Segment, lang?: string): string {
  return (lang ? s.tr?.[lang] : null) ?? s.text;
}

/** Cues of at most 2 lines × 42 chars; long segments are split with time proportional to length. */
export function toCues(segments: Segment[], lang?: string): Cue[] {
  const cues: Cue[] = [];
  for (const s of [...segments].sort((a, b) => a.seq - b.seq)) {
    const lines = wrap(segText(s, lang));
    if (!lines.length) continue;
    const groups: string[][] = [];
    for (let i = 0; i < lines.length; i += 2) groups.push(lines.slice(i, i + 2));
    const start = Math.max(0, s.t0);
    const end = Math.max(start + 0.5, s.t1);
    const total = groups.reduce((n, g) => n + g.join(' ').length, 0);
    let t = start;
    for (const g of groups) {
      const d = ((end - start) * g.join(' ').length) / total;
      cues.push({ start: t, end: t + d, lines: g });
      t += d;
    }
  }
  // never overlap the next cue
  for (let i = 0; i < cues.length - 1; i++) if (cues[i].end > cues[i + 1].start) cues[i].end = Math.max(cues[i].start + 0.1, cues[i + 1].start);
  return cues;
}

function ts(sec: number, sep: ',' | '.'): string {
  const ms = Math.round(sec * 1000);
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}${sep}${pad(ms % 1000, 3)}`;
}

export function toSrt(segments: Segment[], lang?: string): string {
  return toCues(segments, lang).map((c, i) => `${i + 1}\n${ts(c.start, ',')} --> ${ts(c.end, ',')}\n${c.lines.join('\n')}\n`).join('\n');
}

export function toVtt(segments: Segment[], lang?: string): string {
  return `WEBVTT\n\n${toCues(segments, lang).map((c) => `${ts(c.start, '.')} --> ${ts(c.end, '.')}\n${c.lines.join('\n')}\n`).join('\n')}`;
}

export function toTxt(segments: Segment[], lang?: string, title?: string): string {
  const body = [...segments].sort((a, b) => a.seq - b.seq).map((s) => segText(s, lang)).join('\n');
  return `${title ? `${title}\n\n` : ''}${body}\n`;
}

export { CUE_CHARS };
