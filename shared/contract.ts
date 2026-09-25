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
  u?: number;                                             // utterance number: exports re-time phrases within it
}

// ── SSE events: one stream per stage carrying every language ──

/** `recent` = the last 10 segments of the current talk (with translations) so the phone has text at once. */
/** `last` = the talk that ended most recently (downloads on the "talk ended" screen). */
export type HelloEvent = { type: 'hello'; state: StageState; talk: Talk | null; next?: Talk | null; last?: Talk | null; lastSeq: number; recent?: Segment[] };
export type LiveEvent = { type: 'live'; text: string };
/** `lag` = seconds from the end of the spoken audio (t1) to publication; the phone shows it as "~1.4 s". */
/** BENCH=1 only (F17.1): `at` = server wall clock at publication, `heardAt` = first interim that reached the phrase's last word, `endAt` = end of speech (utterances closed by a pause). */
export type SegmentEvent = { type: 'segment'; seq: number; src: string; text: string; t0: number; t1: number; kind: SegmentKind; lag?: number; u?: number; at?: number; heardAt?: number; endAt?: number };
/** `tr` may carry a SUBSET of the languages (F17.4: `es` first, the rest in a later event); clients merge by seq. */
export type TrEvent = { type: 'tr'; seq: number; tr: Record<string, string | null>; ms: number; at?: number };
export type StateEvent = { type: 'state'; state: StageState; talk?: Talk | null; next?: Talk | null; last?: Talk | null };
export type LevelEvent = { type: 'level'; v: number };

export type StageEvent = HelloEvent | LiveEvent | SegmentEvent | TrEvent | StateEvent | LevelEvent;

// ── HTTP API (docs/architecture.md → API). Errors: { error: 'SCREAMING_CODE', message } with 4xx/5xx. ──
//
// Public
//   GET  /api/health?nonce=                → { ok: true, nonce? }
//   GET  /api/event                        → EventInfo
//   GET  /api/stages/:id/stream            → SSE StageEvent (unnamed messages; `id:` on replayable ones)
//   GET  /api/stages/:id/history?before=seq → Segment[] (≤50, ascending by seq, current talk)
//   GET  /api/stages/:id/summary?lang=     → Summary (cached; never generated per request)
//   GET  /api/talks/:id/export.{srt,vtt,txt}?lang=  → file download (lang omitted = original)
//   GET  /api/dev/state?stage=&state=      → fake mode only: forces a StageState (F07.5)
//
// Admin (cookie `ems_admin`; open from 127.0.0.1 while no password is set) → 401 { error: 'UNAUTHENTICATED' }
//   GET  /api/admin/me                     → { authed: boolean; hasPassword: boolean }
//   POST /api/admin/login   { password }   → { ok: true } + Set-Cookie
//   POST /api/admin/logout                 → { ok: true }
//   GET  /api/admin/metrics                → SSE, one AdminMetrics JSON `data:` message per second
//   GET  /api/stages                       → AdminStage[]
//   POST /api/stages        StageInput     → AdminStage (201)
//   PATCH /api/stages/:id   Partial<StageInput> → AdminStage
//   DELETE /api/stages/:id                 → { ok: true }
//   POST /api/stages/:id/start | /stop | /next-talk → AdminStage
//   POST /api/stages/:id/talk  TalkInput    → Talk (generates the glossary; becomes current unless `queue: true`)
//   PUT  /api/talks/:id/glossary Glossary  → Talk (requests an ASR rotation)
//   DELETE /api/talks/:id                  → { ok: true }
//   POST /api/uploads?name=<filename>  (raw body, Content-Type: application/octet-stream) → { path }
//   POST /api/agenda/parse  { text }       → AgendaProposal
//   POST /api/agenda        AgendaProposal → { stages: AdminStage[]; talks: Talk[] }  (progress in AdminMetrics.agenda)
//   POST /api/alerts/:id/snooze            → { ok: true }  ("Wait 5 min" on a talk-switch alert)
//
// Setup (open from 127.0.0.1 or while no password exists; otherwise admin)
//   GET  /api/setup/state                  → SetupState
//   POST /api/setup/key      { key }       → { ok: true } | 400 { error: 'INVALID_KEY' | 'NO_MODEL_ACCESS' | 'NO_QUOTA' | 'NETWORK', message }
//   POST /api/setup/password { password }  → { ok: true }  (min 6 chars)
//   GET  /api/setup/tailscale              → TailscaleStatus
//   POST /api/setup/tailscale/up           → TailscaleStatus  (runs `tailscale up`; poll GET every 2 s)
//   POST /api/setup/tailscale/funnel       → TailscaleStatus  (may carry consentUrl)
//   POST /api/setup/public   { mode, url?, token? } → { ok: true; publicUrl }  (cloudflare: starts cloudflared)
//   POST /api/setup/test     { url }       → { ok: boolean; message?: string }  (nonce round-trip)
//   POST /api/setup/demo                   → { stages: AdminStage[] }  ("Try with sample data")
//   POST /api/setup/done                   → { ok: true }
//
// Station
//   WS   /api/stages/:id/ingest?key=<stationKey>  binary frames: PCM s16le mono 16 kHz, any length

export type PublicMode = 'tailscale' | 'cloudflare' | 'lan' | 'url';

export interface StageSummary extends Stage { talk: Talk | null; next: Talk | null }

export interface EventInfo {
  name: string;
  publicUrl: string;                                      // base for every QR/link, no trailing slash
  stages: StageSummary[];
}

/** Stage as the dashboard sees it: includes the station key and the talk queue. */
export interface AdminStage extends StageSummary {
  stationKey: string;
  talks: Talk[];                                          // every talk of the stage, in order
}

export interface StageInput {
  name: string;
  source: SourceSpec;
  targetLangs?: string[];
}

export interface TalkInput {
  title: string;
  speaker?: string;
  abstract?: string;
  lang?: string;
  slidesText?: string;
  startsAt?: string;
  endsAt?: string;
  queue?: boolean;                                        // true: add as upcoming instead of making it current
}

export interface Summary { lang: string; bullets: string[]; at: number | null }  // at = epoch ms of generation

export interface AgendaTalk {
  room: string; start?: string; end?: string;             // start/end: ISO or "HH:MM" (today)
  title: string; speaker?: string; abstract?: string; lang?: string;
}
export interface AgendaProposal { rooms: string[]; talks: AgendaTalk[] }

export type AlertKind = 'no_audio' | 'delay' | 'errors' | 'talk_switch' | 'public_down' | 'address_changed';
export interface Alert {
  id: string;                                             // stable while the condition lasts
  kind: AlertKind;
  stageId?: string;
  message: string;                                        // plain language, ready to show
  talk?: Talk;                                            // talk_switch: the talk to move to
}

export interface VocabCount { term: string; count: number }

export interface StageMetrics {
  id: string;
  name: string;
  state: StageState;
  level: number;                                          // 0..1
  lastLine: string;                                       // last confirmed segment (original)
  liveLine: string;                                       // current interim
  talk: Talk | null;
  next: Talk | null;
  viewers: number;
  delay: { p50: number; p95: number; p50Tr: number; p95Tr: number } | null;  // seconds, last 50 segments
  lag: number;                                            // seconds: wall clock − start − audioClock
  noAudioSec: number;                                     // seconds without signal (0 when there is audio)
  rotations: number;
  maxGapMs: number;
  reconnects: number;
  errorsPerMin: number;
  http429: number;
  audioMin: number;                                       // minutes of audio sent to the ASR
  costPerHour: number;                                    // estimated US$/h
  model: { transcribe: string; translate: string };
  vocab: VocabCount[];                                    // F10.4, current talk
}

export interface AdminMetrics {
  at: number;
  eventName: string;
  publicUrl: string;
  reachable: boolean | null;                              // null = not checked yet / lan
  totalViewers: number;
  stagesLive: number;
  stages: StageMetrics[];
  alerts: Alert[];
  agenda: { done: number; total: number } | null;         // glossary batch progress (F10.2)
}

export interface SetupState {
  hasKey: boolean;
  keyFromEnv: boolean;
  hasPassword: boolean;
  publicMode: PublicMode;
  publicUrl: string;
  lanUrl: string;                                         // http://<local-ip>:<port>
  docker: boolean;
  port: number;
  stages: number;
  done: boolean;                                          // wizard finished at least once
}

export interface TailscaleStatus {
  installed: boolean;
  running: boolean;                                       // BackendState === 'Running'
  funnel: boolean;
  dnsName: string | null;
  url: string | null;                                     // https://<dnsName>
  consentUrl?: string;                                    // "Click Enable and come back"
  message?: string;
}

// ── Video jobs (F18): subtitle an uploaded video or a YouTube link, one job at a time ──
//   POST /api/jobs?lang=es&srcLang=en&title=&speaker=&abstract=&name=<file>  (raw video body)  → Job (201)
//   POST /api/jobs  { url, lang?, srcLang?, title?, speaker?, abstract? }                       → Job (201)
//   GET  /api/jobs · GET /api/jobs/:id · DELETE /api/jobs/:id
//   GET  /api/jobs/:id/video.mp4 | video.vtt | video.srt   (Range supported on the mp4)

export type JobStatus = 'queued' | 'transcribing' | 'burning' | 'done' | 'error';

export interface Job {
  id: string;
  status: JobStatus;
  progress: number;                                       // 0..1
  etaSec: number;                                         // 0 when done/error
  message?: string;                                       // plain-language step or error
  title: string;
  speaker?: string;
  abstract?: string;
  lang: string;                                           // subtitle language
  srcLang?: string;                                       // spoken language (auto-detect when empty)
  source: { kind: 'file'; name: string } | { kind: 'url'; url: string };
  createdAt: number;
  durationSec?: number;
  speed?: number;                                         // audio fed at N× real time
  segments?: number;
}

export function emptyGlossary(): Glossary {
  return { asrVocabulary: [], doNotTranslate: [], preferred: {}, replacements: {} };
}
