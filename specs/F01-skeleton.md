# F01 · Skeleton and no-key mode

**Priority:** P0 (MVP) · **Lane:** backend (US1–3), either (US4) · **Depends on:** — · **Architecture:** "Repo structure", "Configuration", "Testing"

**Goal:** anyone (and the frontend lane) can run the system without an API key from minute one.

## Stories

### [x] F01.1 · Run the project with one command
As a developer, I want `npm run dev` to start server and web with hot reload, so I can build without setting anything up.

- A single `package.json` with the `dev`, `dev:fake`, `check`, `test`, `smoke` and `build` scripts (see `CLAUDE.md`).
- Fastify on `:8080` answers `GET /api/health` → `{ ok: true }`. Vite serves `web/` and proxies `/api` to the server.
- `shared/contract.ts` with the types from `docs/architecture.md` → "Data model" and "SSE events".
- `config.ts` reads env > `data/config.json` > defaults. `.env.example` and `.gitignore` (`.env`, `data/`, `node_modules`, `dist`).

**Verify:** `npm run dev` and open `http://localhost:5173` (a page that says "Everyone Makes Subs").

### [x] F01.2 · Replayable fake backend
As a frontend developer, I want `FAKE_BACKEND=1` so I can see moving captions without a key or audio.

- `FakeBackend` reads `samples/*.transcript.json` and emits, with the file's timing, the same events as the real pipeline: `live`, `segment`, `tr`, `state` and `level`.
- With `DEMO=1` (or in fake mode) two stages are created: "Auditorium" (es) and "Room 2" (en). When the file ends, it loops.
- The `.transcript.json` format is documented in a comment at the top of `FakeBackend.ts`.

**Verify:** `npm run dev:fake` + `curl -N localhost:8080/api/stages/auditorium/stream` prints events.

### [ ] F01.3 · Audio samples
As a judge without a key, I want sample audio to try the system right away.

- `samples/es.mp3`, `samples/en.mp3` and `samples/mixed.mp3`, 1–2 min each, cut from public talks (`yt-dlp` + `ffmpeg -ss -t`). Note the source in `samples/README.md`.
- One `.transcript.json` per file, with interims, finals and es/en/pt translations. It can be generated once with Gemini and committed.
- Each file under 2 MB (mono mp3, 48 kbps).

**Verify:** `ls -lh samples/`, and fake mode uses these files.

### [x] F01.4 · "Hello world" installer
As the team, we want to find out early whether electron-builder can build the installers, because that's where F14's risk is.

- Minimal `app/main.ts`: an Electron window that shows "Everyone Makes Subs". `npm run app:dist` runs electron-builder (`dmg`, `nsis`, `AppImage` targets) locally.
- No GitHub Actions: installers are built by hand on each OS (see `docs/decisions.md`).

**Verify:** `npm run app:dist` produces the installer for your OS.
