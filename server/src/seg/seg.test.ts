import { describe, expect, it } from 'vitest';
import { stripCommitted, trimOverlap } from './align.js';
import { Segmenter, type Commit } from './Segmenter.js';

function run(steps: Array<['i' | 'f', string] | ['wait', number]>, opts: { replacements?: Record<string, string> } = {}) {
  let t = 0;
  const out: Commit[] = [];
  const seg = new Segmenter({ forceCommitMs: 4500, onCommit: (c) => out.push(c), now: () => t, replacements: () => opts.replacements ?? {} });
  for (const s of steps) {
    if (s[0] === 'wait') t += s[1];
    else if (s[0] === 'i') { seg.onInterim(s[1]); t += 300; }
    else seg.onFinal(s[1]);
  }
  return out;
}

/** Interims growing word by word, as the ASR emits them. */
function grow(text: string): Array<['i', string]> {
  const ws = text.split(' ');
  return ws.map((_, i) => ['i', ws.slice(0, i + 1).join(' ')]);
}

describe('Segmenter', () => {
  it('with a pause: commits the whole utterance on the final', () => {
    const out = run([...grow('Hola a todos'), ['f', 'Hola a todos.']]);
    expect(out.map((c) => c.text)).toEqual(['Hola a todos.']);
  });

  it('with punctuation: commits a sentence of 5+ words before the final, then only the rest', () => {
    const out = run([...grow('Hoy vamos a hablar de observabilidad. Primero veremos'), ['i', 'Hoy vamos a hablar de observabilidad. Primero veremos'], ['f', 'Hoy vamos a hablar de observabilidad. Primero veremos trazas.']]);
    expect(out.map((c) => c.text)).toEqual(['Hoy vamos a hablar de observabilidad.', 'Primero veremos trazas.']);
  });

  it('without a pause: cuts at a comma after 8+ words', () => {
    const out = run([...grow('So the first thing we did was measure everything, and then we started cutting costs')]);
    expect(out[0].text).toBe('So the first thing we did was measure everything,');
  });

  it('without a pause or punctuation: forces a commit after 4.5 s with 4+ words', () => {
    const out = run([['i', 'esto es un'], ['i', 'esto es un texto'], ['wait', 5000], ['i', 'esto es un texto largo']]);
    expect(out.map((c) => c.text)).toEqual(['esto es un texto']);
  });

  it('applies replacements and marks sound', () => {
    const out = run([['f', 'We deploy on cubernetes'], ['f', '[applause]']], { replacements: { cubernetes: 'Kubernetes' } });
    expect(out).toEqual([{ text: 'We deploy on Kubernetes', kind: 'speech' }, { text: '[applause]', kind: 'sound' }]);
  });

  it('filters noise: punctuation only and the same text 3 times in a row', () => {
    const out = run([['f', '...'], ['f', 'Gracias.'], ['f', 'gracias'], ['f', 'Gracias!']]);
    expect(out.map((c) => c.text)).toEqual(['Gracias.', 'gracias']);
  });
});

describe('Segmenter with the real Live API shape (F03.1)', () => {
  // cumulative interims of one long utterance, revising earlier words, as seen in samples/es.mp3
  const script = [
    'más cómodamente',
    'más cómodamente con ellos, ¿no?',
    'más cómodamente con ellos. No es necesario',
    'más cómodamente con ellos. No es necesario necesario, pero sí que',
    'más cómodamente con ellos. No es necesario necesario, pero sí que es una te da un',
    'más cómodamente con ellos. No es necesario necesario, pero sí que es una Eh, te da una calidad de vida para los que trabajamos',
    'más cómodamente con ellos. No es necesario necesario, pero sí que es una Eh, te da una calidad de vida para los que trabajamos con ellos y lo gestionamos.',
    'más cómodamente con ellos. No es necesario necesario, pero sí que es una Eh, te da una calidad de vida para los que trabajamos con ellos y lo gestionamos. ¿Qué pasa entonces? Que normalmente vamos a hablar eso, de clústeres.',
    // the ASR revises an already committed word and drops the repeated "necesario"
    'más cómodamente con ellos. No es necesario, pero sí que es una Eh, te da una calidad de vida para los que trabajamos con ellos y lo gestionamos. ¿Qué pasa entonces? Que normalmente vamos a hablar eso, de clusters. Clusters en los que tendremos nodos,',
    'más cómodamente con ellos. No es necesario, pero sí que es una Eh, te da una calidad de vida para los que trabajamos con ellos y lo gestionamos. ¿Qué pasa entonces? Que normalmente vamos a hablar eso, de clusters. Clusters en los que tendremos nodos, en los que tendremos las apps contenerizadas',
    'más cómodamente con ellos. No es necesario, pero sí que es una Eh, te da una calidad de vida para los que trabajamos con ellos y lo gestionamos. ¿Qué pasa entonces? Que normalmente vamos a hablar eso, de clusters. Clusters en los que tendremos nodos, en los que tendremos las apps contenerizadas y el control plane.',
  ];
  const final = 'más cómodamente con ellos. No es necesario, pero sí que es una te da una calidad de de vida para los que trabajamos con ellos o lo gestionamos. ¿Qué pasa entonces? Que normalmente vamos a hablar eso, de clusters. Clusters en los que tendremos nodos, en los que tendremos las apps contenerizadas y el control plane. Hoy no vamos a entrar en el control plane porque es un tema enorme y además cambia con cada versión de Kubernetes, así que nos vamos a quedar con los nodos.';

  function runScript() {
    let t = 0;
    const out: string[] = [];
    const seg = new Segmenter({ forceCommitMs: 4500, onCommit: (c) => out.push(c.text), now: () => t });
    for (const s of script) { seg.onInterim(s); t += 500; seg.onInterim(s); t += 500; }
    const beforeFinal = out.length;
    seg.onFinal(final);
    return { out, beforeFinal };
  }

  it('keeps committing phrases while the ASR revises earlier words', () => {
    const { out, beforeFinal } = runScript();
    expect(beforeFinal).toBeGreaterThanOrEqual(4);
    const live = out.slice(0, beforeFinal).join(' ');
    expect(live).toContain('Clusters en los que tendremos nodos,');
    expect(live).not.toContain('clusters. Clusters');   // the revised "clústeres." is not published again
  });

  it('publishes every word once and splits a long final into phrases', () => {
    const { out } = runScript();
    for (const p of out) expect(p.split(' ').length).toBeLessThanOrEqual(22);
    const all = out.join(' ');
    expect(all.match(/gestionamos/g)).toHaveLength(1);
    expect(all.match(/control plane/g)).toHaveLength(2);   // "...y el control plane." + "Hoy no vamos a entrar en el control plane"
    expect(all).toContain('nos vamos a quedar con los nodos.');
  });
});

describe('align', () => {
  it('stripCommitted ignores punctuation and casing changes', () => {
    expect(stripCommitted('hola a todos gracias por venir', 'Hola a todos, gracias por venir tan temprano.')).toBe('tan temprano.');
  });

  it('stripCommitted tolerates one changed word', () => {
    expect(stripCommitted('we deploy on cubernetes every day', 'We deploy on Kubernetes every day, twice.')).toBe('twice.');
  });

  it('stripCommitted returns everything when nothing was committed', () => {
    expect(stripCommitted('', 'Hola.')).toBe('Hola.');
  });

  it('stripCommitted with accents', () => {
    expect(stripCommitted('la sesion de hoy', 'La sesión de hoy termina acá.')).toBe('termina acá.');
  });

  it('trimOverlap removes the repeated tail', () => {
    expect(trimOverlap('we measured the latency of every request', 'of every request and then we cut costs')).toBe('and then we cut costs');
  });

  it('trimOverlap keeps text with no overlap', () => {
    expect(trimOverlap('first sentence here', 'something else entirely')).toBe('something else entirely');
  });
});
