# F05 · Parallel stages and broadcast

**Priority:** P0 (MVP) · **Lane:** backend · **Depends on:** F04 (or F01.2 in fake mode) · **Architecture:** "Components", "API", "SSE events"

**Goal:** N stages processed at once, each broadcast to any number of viewers. **This + F07.1–2 completes the MVP.**

## Stories

### [ ] F05.1 · Several stages at once
As an operator, I want several stages running in parallel, each with its own source.

- `StageManager` creates, starts, stops and deletes `StageWorker`s. One worker = source + meter + transcription + segmenter + translator.
- Admin routes (no auth until F09.1): `POST /api/stages`, `PATCH /api/stages/:id`, `DELETE /api/stages/:id` and `POST /api/stages/:id/{start,stop}`.
- `GET /api/event`: stages, state, current talk and viewer count.
- If one worker fails, the others are unaffected.

**Verify:** 2 stages with `es.mp3` and `en.mp3` in parallel; the logs show both advancing.

### [ ] F05.2 · Stream per stage
As an attendee, I want my stage's captions in real time, without losing anything if my connection drops.

- `GET /api/stages/:id/stream`: SSE with every language (`hello`, `live`, `segment`, `tr`, `state` and `level`).
- `EventBus` keeps a 300-event ring per stage. `Last-Event-ID` replays what's missing. `hello` includes the last 10 phrases.
- Heartbeat every 15 s. Headers `Cache-Control: no-cache` and `X-Accel-Buffering: no`.
- Counts open connections per stage (viewers).

**Verify:** `npm run smoke` passes, and disconnecting/reconnecting with `Last-Event-ID` loses no segments.

### [ ] F05.3 · Persistence and restart
As an operator, I don't want a restart to wipe the stages or the transcript.

- `data/stages.json` and `data/talks.json` are written on every change. On boot, stages are recreated (those that were live start again).
- `Store` appends each segment with its translations to `data/<stage>/<talk>.jsonl`.
- `GET /api/stages/:id/history?before=<seq>` returns the previous 50 segments.

**Verify:** restart the server with 2 live stages: they come back on their own and the history is still there.
