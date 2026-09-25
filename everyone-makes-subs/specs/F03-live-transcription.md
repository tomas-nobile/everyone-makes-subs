# F03 · Live transcription

**Priority:** P0 (MVP) · **Lane:** backend · **Depends on:** F02 · **Architecture:** "3. TranscribeSession"

**Goal:** turn audio into interim and final text with Gemini Transcribe Live, with reliable timing.

## Stories

### [x] F03.1 · Spike: how the Live API behaves
As the team, we need to answer 3 questions with real audio before writing the segmenter, because everything else depends on them.

- Script `server/scripts/spike-live.ts` that streams `samples/es.mp3` and logs every raw message with a timestamp.
- Answers logged in `docs/decisions.md` with the `LIVE-API:` prefix:
  1. Are interims cumulative or deltas?
  2. With a speaker who doesn't pause, how often does a final arrive?
  3. Does the session accept audio after `audioStreamEnd`?
- Also log the real model and field names if they differ from `docs/architecture.md`.

**Verify:** the 3 answers are written down. Timebox: 45 minutes.

### [x] F03.2 · Interims and finals
As an attendee, I want to see text while the speaker talks, and have it settle afterwards.

- `TranscribeSession` opens the session with `languageCodes` (empty = auto), `customVocabulary` = `glossary.asrVocabulary` and `mode: 'VERBATIM'`.
- Emits `onInterim(cumulativeText)` (if deltas arrive, it concatenates them per utterance) and `onFinal(text, t0, t1)`, with times taken from `audioClock`.
- Sends only chunks with speech, plus 300 ms of pre-roll when resuming after more than 2 s of silence.
- Counts seconds of audio sent (for cost).

**Verify:** `samples/es.mp3` prints interims and finals to the console with consistent `t0`/`t1`.
