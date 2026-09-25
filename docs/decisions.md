# Decisions and TODOs

One line per entry, newest first. Prefixes: `DECISION:`, `TODO:`, `CONTRACT:` (change requested to `shared/contract.ts`), `LIVE-API:` (findings from F03.1).

- 2026-09-24 · DECISION: segmenter cuts at the LAST sentence end in the pending text (≥5 words), else at the last comma/conjunction when ≥8 words; stripCommitted picks the prefix with minimum word edit distance (≤20%, else cuts by committed word count); trimOverlap needs ≥2 matching words (F04.1/F04.2).
- 2026-09-24 · TODO: F03.1 — spike not run: no Gemini key and no sample audio on the build machine. `server/scripts/spike-live.ts` is ready. Until then, from the SDK 2.24 types: interims = `serverContent.interimInputTranscription`, finals = `serverContent.inputTranscription` (`finished`), `goAway` exists; `LiveSession` accepts interims both cumulative and as deltas, and treats `turnComplete` as a final too.
- 2026-09-24 · TODO: meter threshold can climb to its 0.05 RMS cap during loud intro music, so quiet speech right after reads as "silent" (seen on a Nerdearla YouTube talk). Tune the cap/percentile when F03 uses it for rotation.
- 2026-09-24 · DECISION: YouTube works with yt-dlp 2026.08.19 standalone and no deno (resolves in ~3.5 s). The direct URL is re-resolved on every ffmpeg restart because it expires. Non-YouTube URLs get `-re` only if the path ends in a media extension; http inputs get ffmpeg `-reconnect` flags (F02.2).
- 2026-09-24 · DECISION: `AudioSource` owns the retry loop (exit or 5 s without data → `no_signal`, backoff 1-2-4…30 s, reset on data) and emits its own `connecting|live|no_signal`; the StageWorker (F05) maps that to the stage state. `clock` keeps counting across restarts and loops (F02.4).
- 2026-09-24 · DECISION: meter threshold = p10 of the last 30 s × 2, clamped to [0.002, 0.05] RMS so digital silence never counts as speech and a long loud stretch can't calibrate speech into silence. `level` is dBFS mapped to 0–1 (-60 dB → 0), emitted as the peak every 250 ms of audio (F02.3).

- 2026-09-24 · DECISION: no GitHub Actions. `release.yml` removed; F01.4 is done as the Electron hello world + a local `npm run app:dist` (Windows NSIS verified). F14.3 = build installers locally per OS and upload them to a GitHub Release by hand (no `.dmg` unless someone builds it on a Mac).
- 2026-09-24 · TODO: F01.3 — `samples/*.transcript.json` are hand-written placeholders with synthetic timing and no mp3s; replace with real public-talk cuts + Gemini transcripts.
- 2026-09-24 · DECISION: SSE sends unnamed messages (`id:` + `data: {type,…}`), so the client uses `EventSource.onmessage` and switches on `type`. `hello` has no id; `live`/`level` are not kept in the replay ring (F01.2).
- 2026-09-24 · DECISION: fake mode bypasses the segmenter: each transcript `final` becomes one `segment`, then `tr` after `mtMs`. At the end of the file it emits `paused`, then loops with seq/t0/t1 still increasing (F01.2).
- 2026-09-24 · DECISION: Vite proxy targets `127.0.0.1:$PORT` (env or `.env`, default 8080) so a machine where 8080 is taken (Docker/WSL/VS Code forwards) can use `PORT=8090` for both halves (F01.1).
- 2026-09-24 · DECISION: server is bundled with esbuild (`--packages=external`) instead of `tsc` emit, so imports need no extension rewriting; web builds to `dist/web` and Fastify serves it when present (F01.1).

<!-- Example:
- 2026-09-25 01:10 · LIVE-API: interims arrive as deltas; TranscribeSession concatenates them.
- 2026-09-25 02:30 · TODO: dedupe fails when the final rewrites more than 3 words (F04.2).
-->
