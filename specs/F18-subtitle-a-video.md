# F18 · Subtitle a video

**Priority:** P1 · **Lane:** backend (F18.1) + frontend (F18.2) · **Depends on:** F13.1 (export), `scripts/subtitle-clip.ts` (the CLI already does it for clips)

As an organizer, I want to upload a talk video (or paste a YouTube link) and get it back with Spanish subtitles burned in, plus SRT/VTT — for example, to publish last year's English talks translated.

## Stories

### [ ] F18.1 · Video jobs (server)
As the operator, I want the server to turn a video into a subtitled one without the terminal.

- `POST /api/jobs` (admin): raw upload like `/api/uploads`, or `{ url }` (YouTube via yt-dlp), plus `{ lang = 'es', srcLang?, title?, speaker?, abstract? }` → `{ id }`.
- `GET /api/jobs` and `GET /api/jobs/:id` → `{ status: 'queued' | 'transcribing' | 'burning' | 'done' | 'error', progress: 0..1, etaSec, message? }`; `GET /api/jobs/:id/video.mp4 | .vtt | .srt`.
- Same pipeline as `npm run clip` (reuse its code): `runFile` → export VTT → ffmpeg `subtitles` burn, with the glossary generated from title/abstract.
- Speed: the Live API is fed in real time today. Try 2× and 4×; keep the fastest speed whose transcript matches the 1× run, log it in `docs/decisions.md`.
- One job at a time, the rest queue. Files in `data/jobs/<id>/`; after a restart a running job shows as `error` ("interrupted"), done ones stay.
- Fake mode: a fake job burns a VTT built from a sample transcript, so F18.2 can be built without a key.

**Verify:** a 2-minute English mp4 → `video.mp4` with Spanish subtitles; progress reaches 1.

### [ ] F18.2 · "Subtitle a video" in the dashboard
As the operator, I want to do it from the dashboard.

- Header button → modal: drop a file or paste a link, subtitle language (Spanish by default), optional title/abstract. Operator UI in English, like the rest.
- Job list: progress bar and ETA; when done, an inline `<video>` preview with the subtitles and Download video / VTT / SRT buttons.

**Verify:** upload from the UI → the preview plays with Spanish subtitles → the downloads work.

### [ ] F18.3 · Burned-in style (optional)
As a viewer of the subtitled video, I want it to look like the room screen.

- ffmpeg `force_style` matching the TV: white on a semi-transparent black box, 2 lines max, ~42 characters per line, Atkinson Hyperlegible / Segoe UI.

**Verify:** one frame screenshot compared with `/s/:id/tv`.
