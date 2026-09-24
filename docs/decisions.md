# Decisions and TODOs

One line per entry, newest first. Prefixes: `DECISION:`, `TODO:`, `CONTRACT:` (change requested to `shared/contract.ts`), `LIVE-API:` (findings from F03.1).

- 2026-09-24 · TODO: F01.4 — workflow + Electron hello world are in; the Windows NSIS build works locally (`npm run app:dist`). Still untested on Actions: the repo has no GitHub remote yet. Create it, push `main`, then `git tag v0.0.1 && git push origin v0.0.1` and check the 3 files on the Release.
- 2026-09-24 · DECISION: release.yml builds each OS with `--publish never` and uploads artifacts; one final job creates the Release with `softprops/action-gh-release` (avoids 3 jobs racing to create the same Release) (F01.4).
- 2026-09-24 · TODO: F01.3 — `samples/*.transcript.json` are hand-written placeholders with synthetic timing and no mp3s; replace with real public-talk cuts + Gemini transcripts.
- 2026-09-24 · DECISION: SSE sends unnamed messages (`id:` + `data: {type,…}`), so the client uses `EventSource.onmessage` and switches on `type`. `hello` has no id; `live`/`level` are not kept in the replay ring (F01.2).
- 2026-09-24 · DECISION: fake mode bypasses the segmenter: each transcript `final` becomes one `segment`, then `tr` after `mtMs`. At the end of the file it emits `paused`, then loops with seq/t0/t1 still increasing (F01.2).
- 2026-09-24 · DECISION: Vite proxy targets `127.0.0.1:$PORT` (env or `.env`, default 8080) so a machine where 8080 is taken (Docker/WSL/VS Code forwards) can use `PORT=8090` for both halves (F01.1).
- 2026-09-24 · DECISION: server is bundled with esbuild (`--packages=external`) instead of `tsc` emit, so imports need no extension rewriting; web builds to `dist/web` and Fastify serves it when present (F01.1).

<!-- Example:
- 2026-09-25 01:10 · LIVE-API: interims arrive as deltas; TranscribeSession concatenates them.
- 2026-09-25 02:30 · TODO: dedupe fails when the final rewrites more than 3 words (F04.2).
-->
