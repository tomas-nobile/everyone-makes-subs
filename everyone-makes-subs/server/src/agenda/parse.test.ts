import { describe, expect, it } from 'vitest';
import { parseAgendaText } from './parse.js';

const SAMPLE = `AUDITORIO
14:30 Observabilidad sin humo con OpenTelemetry — Lucía Fernández
Cómo instrumentamos 200 microservicios en Kubernetes con OTLP y tail-based sampling...
15:30 WebAssembly fuera del navegador: lo que nadie te cuenta — Martín Ibarra

SALA 2
14:45 Edge AI on a budget — Priya Raman (talk in English)
15:45 Rust para devs de Go — Sofía Paz`;

describe('parseAgendaText', () => {
  const out = parseAgendaText(SAMPLE);

  it('finds 2 rooms and 4 talks', () => {
    expect(out.rooms).toEqual(['Auditorio', 'Sala 2']);
    expect(out.talks).toHaveLength(4);
  });

  it('reads time, title, speaker, abstract and the end from the next talk', () => {
    expect(out.talks[0]).toMatchObject({
      room: 'Auditorio', start: '14:30', end: '15:30', title: 'Observabilidad sin humo con OpenTelemetry',
      speaker: 'Lucía Fernández', lang: 'es',
    });
    expect(out.talks[0].abstract).toContain('OTLP');
  });

  it('uses the language hint', () => {
    expect(out.talks[2]).toMatchObject({ room: 'Sala 2', title: 'Edge AI on a budget', speaker: 'Priya Raman', lang: 'en' });
  });
});
