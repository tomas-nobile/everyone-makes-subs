# Decisions and TODOs

One line per entry, newest first. Prefixes: `DECISION:`, `TODO:`, `CONTRACT:` (change requested to `shared/contract.ts`), `LIVE-API:` (findings from F03.1).

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
