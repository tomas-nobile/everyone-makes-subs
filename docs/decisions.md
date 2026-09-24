# Decisions and TODOs

One line per entry, newest first. Prefixes: `DECISION:`, `TODO:`, `CONTRACT:` (change requested to `shared/contract.ts`), `LIVE-API:` (findings from F03.1).

- 2026-09-24 · DECISION: Vite proxy targets `127.0.0.1:$PORT` (env or `.env`, default 8080) so a machine where 8080 is taken (Docker/WSL/VS Code forwards) can use `PORT=8090` for both halves (F01.1).
- 2026-09-24 · DECISION: server is bundled with esbuild (`--packages=external`) instead of `tsc` emit, so imports need no extension rewriting; web builds to `dist/web` and Fastify serves it when present (F01.1).

<!-- Example:
- 2026-09-25 01:10 · LIVE-API: interims arrive as deltas; TranscribeSession concatenates them.
- 2026-09-25 02:30 · TODO: dedupe fails when the final rewrites more than 3 words (F04.2).
-->
