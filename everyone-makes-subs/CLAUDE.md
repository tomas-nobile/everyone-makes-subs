# Everyone Makes Subs

Live captions and translation for every stage of a conference, with a single Gemini API key. Built for the **Nerdearla Vibeathon 2026**. **Deadline: Sept 25, 12:00 ART.** Everything is measured against that clock.

## Working mode: speed first

This is a hackathon, not a production product. The rules:

1. **Don't ask.** When a decision comes up, pick the simplest option that meets the story's acceptance criteria, log it in one line in `docs/decisions.md` and keep going. Only stop if the decision is irreversible and can't be derived from `docs/`.
2. **Work on `main`.** No branches, no PRs, no issues. **One commit per story**: `F04.2: word-alignment dedupe`.
3. **Read only what you need:** the feature's `.md` and the sections of `docs/architecture.md` it cites. Don't read all of `docs/` just in case.
4. **Minimal verification per story:**
   - Always: `npm run check` (typecheck) before committing.
   - Pure logic (segmenter, alignment, export, rotation, agenda parser): one vitest test, written together with the code, not before.
   - UI: open the page once (or take one Playwright screenshot if there's no browser) and compare with `docs/ui-prototype.html`. No screenshot loops.
   - No controller tests, coverage, e2e or reviewer agents.
5. **20-minute timebox.** If something doesn't work in 20 minutes, leave a working stub, log a `TODO:` in `docs/decisions.md` and move to the next story.
6. **Don't refactor what works** and don't add abstractions "for later". Duplicating twice is fine.
7. **Never commit secrets.** The key lives in `.env` or `data/config.json`, both in `.gitignore`. A hook blocks commits that contain keys.

## Docs

| File | Purpose |
|---|---|
| `docs/README.md` | Feature index, build order, status of every story, cut order |
| `specs/FNN-*.md` | One feature per file, with its stories and acceptance criteria |
| `docs/architecture.md` | Technical blueprint: pipeline, contracts, API, SSE events, deploy |
| `docs/product.md` | What it is and who it's for (non-technical) |
| `docs/ui-prototype.html` | **Visual source of truth** for every screen |
| `docs/decisions.md` | One-line decisions and TODOs |

## Stack and layout

Node 22 + TypeScript + Fastify · `@google/genai` · ffmpeg (`ffmpeg-static`) + yt-dlp · Vite + React · vitest · JSON/JSONL in `data/` · Electron for the installer.

**A single `package.json` at the root** (no workspaces).

```
shared/contract.ts   shared types: Stage, Talk, Segment, Glossary, SSE events
server/src/          Fastify + pipeline (audio → asr → seg → mt → bus → sse)
web/src/pages/       Viewer, TV, Overlay, Station, Admin, Setup, Home
app/                 Electron (F14)
specs/               one .md per feature (FNN-*.md)
samples/             audio + *.transcript.json for FAKE_BACKEND
data/                runtime (gitignored)
```

**UI language:** all code, comments, logs and operator UI in English. The attendee views (phone, TV, overlay) are localized in en/es/pt and default to the phone's language.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Server (8080) + Vite with hot reload |
| `npm run dev:fake` | Same, with `FAKE_BACKEND=1` (no key, replays `samples/`) |
| `npm run check` | `tsc --noEmit` for everything. Fast: run it before every commit |
| `npm test` | vitest (pure logic only) |
| `npm run smoke` | Boots the fake server, connects to SSE and checks that `segment` and `tr` arrive within 15 s |
| `npm run build` | Builds web + server |

The shell is **Git Bash on Windows**: use `cross-env` for env vars in npm scripts, and `/` in paths.

## Two lanes in parallel

Two Claude sessions can work at the same time **in the same folder, on `main`**:

- **Backend lane:** `server/`, `shared/`, `samples/`. Features F02–F06, F10 (server side) and F13.
- **Frontend lane:** `web/`. Features F07, F08, F09, F11 and F12, against `npm run dev:fake`.

Parallel-mode rules:

- Each lane commits **only its own folders**: `git add server shared docs` or `git add web docs`. Never `git add -A`.
- Only the backend lane edits `shared/contract.ts`. If the frontend needs a new field, it logs a `CONTRACT:` line in `docs/decisions.md` and mocks it locally.
- If `index.lock` shows up, wait 2 seconds and retry.

## Contracts you don't change without logging it

- **Internal audio:** PCM s16le, mono, 16 kHz, 3,200-byte chunks (100 ms). `audioClock` = bytes **read from the source** / 32,000.
- **SSE:** one stream per stage carrying every language: `hello`, `live`, `segment`, `tr`, `state` and `level` events (see `docs/architecture.md` → API).
- **Stage states:** `idle | connecting | live | paused | no_signal | degraded | error`.

## Known gotchas

- Live API model and field names are unverified until F03.1. If they differ, whatever F03.1 logged in `docs/decisions.md` wins.
- Cloudflare's quick tunnel **doesn't support SSE**. Public access is Tailscale Funnel or a named Cloudflare tunnel (F11).
- `getUserMedia` requires HTTPS outside `localhost`.
- Cloud Run is not part of the deploy plan.
