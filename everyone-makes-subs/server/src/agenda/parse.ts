import type { AgendaProposal, AgendaTalk } from '../../../shared/contract.js';

// Offline agenda parser: used in fake mode and as the fallback when the AUX model fails.
// Understands the usual website shape: a room header line, then "HH:MM Title — Speaker" lines,
// optionally followed by abstract lines.

const TIME = /^\s*(\d{1,2})[:.h](\d{2})\s*(?:[-–—]\s*(\d{1,2})[:.h](\d{2}))?\s*(?:hs?\b)?[\s·|-]*(.*)$/i;
const SPEAKER_SEP = /\s+(?:—|–|-|\||·|by|por)\s+/i;
const LANG_HINT: Array<[RegExp, string]> = [
  [/\((?:talk )?in english\)|\(en\)|\[en\]|\(ingl[eé]s\)/i, 'en'],
  [/\((?:en )?espa[nñ]ol\)|\(es\)|\[es\]|\(in spanish\)/i, 'es'],
  [/\((?:em )?portugu[eê]s\)|\(pt\)|\[pt\]|\(in portuguese\)/i, 'pt'],
];

export function guessLang(text: string): string | undefined {
  const t = ` ${text.toLowerCase().replace(/[^\p{L}\s]/gu, ' ')} `;
  const score = (ws: string[]) => ws.reduce((n, w) => n + (t.includes(` ${w} `) ? 1 : 0), 0);
  const es = score(['de', 'la', 'el', 'con', 'para', 'que', 'del', 'sin', 'en', 'los', 'las', 'lo', 'fuera', 'cómo', 'nadie', 'años', 'devs', 'y']);
  const en = score(['the', 'on', 'of', 'for', 'and', 'with', 'to', 'in', 'a', 'how', 'your', 'budget', 'building']);
  const pt = score(['não', 'com', 'para', 'uma', 'um', 'do', 'da', 'em', 'como', 'você', 'são']);
  const best = Math.max(es, en, pt);
  if (best === 0) return undefined;
  return best === en && en > es ? 'en' : best === pt && pt > es ? 'pt' : 'es';
}

function titleCase(s: string): string {
  return s.toLowerCase().replace(/(^|\s)\p{L}/gu, (m) => m.toUpperCase());
}

const pad = (h: string, m: string) => `${h.padStart(2, '0')}:${m}`;

export function parseAgendaText(text: string): AgendaProposal {
  const rooms: string[] = [];
  const talks: AgendaTalk[] = [];
  let room = '';
  let last: AgendaTalk | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) { last = null; continue; }
    const m = TIME.exec(line);
    if (m && m[5]) {
      if (!room) { room = 'Main stage'; rooms.push(room); }
      let rest = m[5].trim();
      let lang: string | undefined;
      for (const [re, l] of LANG_HINT) if (re.test(rest)) { lang = l; rest = rest.replace(re, '').trim(); }
      const [title, ...who] = rest.split(SPEAKER_SEP);
      const t: AgendaTalk = { room, start: pad(m[1], m[2]), title: title.trim(), speaker: who.join(', ').trim() || undefined, lang };
      if (m[3]) t.end = pad(m[3], m[4]);
      const prev = [...talks].reverse().find((x) => x.room === room);
      if (prev && !prev.end) prev.end = t.start;
      talks.push(t);
      last = t;
      continue;
    }
    const isHeader = line.length <= 40 && !/[.?!…]$/.test(line) && (line === line.toUpperCase() || /^(sala|room|stage|auditorio|auditorium|track|escenario)\b/i.test(line));
    if (isHeader || !last) {
      room = /[a-z]/.test(line) ? line.replace(/:$/, '') : titleCase(line.replace(/:$/, ''));
      if (!rooms.includes(room)) rooms.push(room);
      last = null;
    } else {
      last.abstract = last.abstract ? `${last.abstract} ${line}` : line;
    }
  }
  for (const t of talks) t.lang ??= guessLang(`${t.title} ${t.abstract ?? ''}`);
  return { rooms, talks };
}
