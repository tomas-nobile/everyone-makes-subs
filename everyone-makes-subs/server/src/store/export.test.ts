import { describe, expect, it } from 'vitest';
import type { Segment } from '../../../shared/contract.js';
import { toCues, toSrt, toVtt } from './export.js';

const seg = (seq: number, t0: number, t1: number, text: string, en?: string | null): Segment =>
  ({ seq, talkId: 't', src: 'es', text, tr: { es: text, en: en ?? null }, t0, t1, kind: 'speech', ms: { asr: 0 } });

describe('export', () => {
  const segs = [
    seg(1, 0.6, 2.65, 'Hola a todos, gracias por venir tan temprano.', 'Hi everyone, thanks for coming so early.'),
    seg(2, 3.1, 12.2, 'La mayoría de los equipos tiene dashboards, pero cuando algo se rompe a las tres de la mañana nadie sabe qué request falló ni en qué servicio.', null),
  ];

  it('formats SRT with comma milliseconds and 1-based indexes', () => {
    expect(toSrt(segs, 'en').split('\n').slice(0, 4)).toEqual(['1', '00:00:00,600 --> 00:00:02,650', 'Hi everyone, thanks for coming so early.', '']);
  });

  it('formats VTT with the header and dot milliseconds', () => {
    const vtt = toVtt(segs);
    expect(vtt.startsWith('WEBVTT\n\n00:00:00.600 --> 00:00:02.650\nHola a todos, gracias por venir tan\ntemprano.\n')).toBe(true);
  });

  it('keeps cues to 2 lines of 42 chars and splits long segments in time order', () => {
    const cues = toCues(segs, 'en');
    for (const c of cues) {
      expect(c.lines.length).toBeLessThanOrEqual(2);
      for (const l of c.lines) expect(l.length).toBeLessThanOrEqual(42);
    }
    const long = cues.filter((c) => c.start >= 3.1);
    expect(long.length).toBeGreaterThan(1);
    expect(long.at(-1)!.end).toBeCloseTo(12.2, 5);
    for (let i = 1; i < cues.length; i++) expect(cues[i].start).toBeGreaterThanOrEqual(cues[i - 1].end);
  });

  it('re-times the phrases of one utterance over its audio span, by length', () => {
    // a lagging ASR: 3 phrases committed late, the last two all at the end of the file
    const u = [
      { ...seg(1, 0.4, 26.8, 'pero sí que es una'), u: 1 },
      { ...seg(2, 26.8, 90, 'que esos contenedores van a tener una parte que es el volumen persistente'), u: 1 },
      { ...seg(3, 90, 90, 'y los PVCs'), u: 1 },
    ];
    const cues = toCues(u);
    expect(cues[0].start).toBeCloseTo(0.4, 2);
    expect(cues.at(-1)!.end).toBeCloseTo(90, 1);
    // the first (short) phrase no longer lasts 26 s
    expect(cues[0].end - cues[0].start).toBeLessThan(20);
    for (let i = 1; i < cues.length; i++) expect(cues[i].start).toBeGreaterThanOrEqual(cues[i - 1].end - 0.001);
  });

  it('falls back to the original when the translation is null', () => {
    expect(toSrt([segs[1]], 'en')).toContain('La mayoría');
  });
});
