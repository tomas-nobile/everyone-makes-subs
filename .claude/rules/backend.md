---
paths:
  - "server/**"
  - "shared/**"
---

# Backend

- Fastify routes live in `server/src/index.ts` until it passes ~300 lines; only then split by domain.
- One `StageWorker` per stage. Everything talks through `EventBus` (EventEmitter). No dependency injection or ports/adapters: import directly.
- Every module that calls Gemini has a twin in `FAKE_BACKEND` (same interface, data from `samples/`). If you add a Gemini call, add the fake in the same story.
- Gemini errors: backoff 1-2-4 s, 3 attempts, then degrade (see F04.4). Never crash the process.
- Child processes (ffmpeg, yt-dlp, cloudflared): always `spawn`, kill them when the stage stops, restart with backoff if they die.
- Logs: `console.log` prefixed with `[stage-id]`. No logging libraries.
- Tests only for pure functions: `seg/`, `align`, `store/export`, `agenda/parse` and the rotation timing.
