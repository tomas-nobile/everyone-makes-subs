# F14 · Packaging

**Priority:** P1 (US1) · P2 (US2–3) · **Lane:** either · **Depends on:** F05, F11, F01.4 · **Architecture:** "Deploy"

## Stories

### [ ] F14.1 · Docker
As a judge, I want to start it with one command.

- Multi-stage `Dockerfile` (standalone yt-dlp with a pinned version, deno) + `.dockerignore`, as in `docs/architecture.md`.
- `docker-compose.yml` with a `./data` volume and MediaMTX under the `advanced` profile.
- `docker compose up` with `GEMINI_API_KEY`, or without it, the setup wizard. `DEMO=1` creates the sample stages.

**Verify:** `git clone` into a clean folder + `docker compose up --build` → `/` shows 2 stages.

### [ ] F14.2 · Desktop app
As an operator who isn't a developer, I want to install and open an app.

- `app/main.ts`: `startServer({ dataDir: app.getPath('userData') })`, window on `/setup` or `/admin`, `powerSaveBlocker`, tray with "N stages live" and a confirmation on close.
- `ffmpeg-static` in `extraResources`. On Mac, `NSMicrophoneUsageDescription`.

**Verify:** the installer for your OS opens the app and reaches the setup wizard.

### [ ] F14.3 · Publish the installers
As the team, we want downloadable installers for the judges.

- No GitHub Actions: build with `npm run app:dist` on each available OS and upload the files from `app/release/` to a GitHub Release by hand (`gh release create v1.0.0 app/release/*.exe …`). The README links to the latest Release assets and explains the "unsigned app" warning (Mac: right-click > Open; Windows: More info > Run anyway).

**Verify:** tag `v1.0.0` publishes the 3 installers.
