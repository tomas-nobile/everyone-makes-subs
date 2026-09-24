# F13 · Export and summary

**Priority:** P1 (US1) · P2 (US2) · **Lane:** backend (+ buttons on the frontend) · **Depends on:** F05.3 · **Architecture:** "API", "6. … Summary"

## Stories

### [ ] F13.1 · Download captions
As an organizer, I want each talk's transcript to upload to YouTube.

- `GET /api/talks/:id/export.{srt,vtt,txt}?lang=` built from the talk's JSONL, using `t0`/`t1`.
- SRT/VTT: at most 2 lines of 42 characters per cue; long segments are split into cues proportional to time.
- Buttons in the dashboard (Downloads) and in the attendee view when the talk ends.

**Verify:** vitest test for SRT/VTT formatting. The exported VTT plays correctly in a video player.

### [ ] F13.2 · "What did I miss?"
As an attendee who arrived late or got distracted, I want a summary of the last few minutes.

- `Summarizer`: every 60 s, if there are new segments, 3–5 bullets covering the last 5 min in each language, via `AUX_MODEL`. Cached in memory.
- `GET /api/stages/:id/summary?lang=` returns the cached one. It is **never** generated per request, so cost doesn't grow with the audience.
- In fake mode, a fixed summary.

**Verify:** with 3 min of sample audio, the phone button shows bullets and the log confirms one generation per minute, not one per click.
