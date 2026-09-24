// Shared types between server and web. Only the backend lane edits this file.
// Source: docs/architecture.md → "Data model" and "SSE events".

export type SourceSpec =
  | { kind: 'station' }                                    // audio over WS from /station/:id
  | { kind: 'url'; url: string }                           // YouTube (yt-dlp) or any URL ffmpeg can read
  | { kind: 'file'; path: string; loop?: boolean }         // uploaded from the Dashboard
  | { kind: 'mediamtx'; path: string };                    // rtmp://host:1935/<path> or srt streamid=<path>

export type StageState =
  | 'idle'          // stopped
  | 'connecting'
  | 'live'          // there is speech and captions
  | 'paused'        // there is signal but silence > 20 s
  | 'no_signal'     // the source sends no audio
  | 'degraded'      // running with delay or errors
  | 'error';        // retrying

export interface Stage {
  id: string;
  name: string;
  source: SourceSpec;
  targetLangs: string[];
  state: StageState;
  talkId?: string;
  viewers: number;
}

export interface Glossary {
  asrVocabulary: string[];                                // ≤100 → customVocabulary
  doNotTranslate: string[];
  preferred: Record<string, Record<string, string>>;      // term → { es: '...', pt: '...' }
  replacements: Record<string, string>;                   // "cubernetes" → "Kubernetes"
}

export interface Talk {
  id: string;
  stageId: string;
  title: string;
  speaker?: string;
  abstract?: string;
  lang?: string;                                          // declared or detected language
  startsAt?: string;
  endsAt?: string;
  glossary: Glossary;
  status: 'next' | 'live' | 'done';
}

export type SegmentKind = 'speech' | 'sound' | 'audience';

export interface Segment {
  seq: number;
  talkId: string;
  src: string;
  text: string;
  tr: Record<string, string | null>;                      // null = translation failed
  t0: number;                                             // seconds of audio since the start of the talk
  t1: number;
  kind: SegmentKind;
  ms: { asr: number; mt?: number };
}

// ── SSE events: one stream per stage carrying every language ──

export type HelloEvent = { type: 'hello'; state: StageState; talk: Talk | null; next?: Talk | null; lastSeq: number };
export type LiveEvent = { type: 'live'; text: string };
export type SegmentEvent = { type: 'segment'; seq: number; src: string; text: string; t0: number; t1: number; kind: SegmentKind };
export type TrEvent = { type: 'tr'; seq: number; tr: Record<string, string | null>; ms: number };
export type StateEvent = { type: 'state'; state: StageState; talk?: Talk | null; next?: Talk | null };
export type LevelEvent = { type: 'level'; v: number };

export type StageEvent = HelloEvent | LiveEvent | SegmentEvent | TrEvent | StateEvent | LevelEvent;

export function emptyGlossary(): Glossary {
  return { asrVocabulary: [], doNotTranslate: [], preferred: {}, replacements: {} };
}
