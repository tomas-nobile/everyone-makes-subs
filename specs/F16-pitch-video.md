# F16 · Pitch video by judging criterion

**Priority:** P0 · **Lane:** either (`scripts/`) · **Depends on:** F17.1 (latency numbers), F18 (subtitle a video), F19 (rooms, load and cost numbers) · **Replaces:** the F15.2 video

The judges score **Quality, Latency, Scalability, Deployment & operation and Innovation**. The video is one chapter per criterion, in sales order: **Deploy → Quality → Latency → Scalability → Innovation → Price**. Each chapter opens with a short explanation slide over the running app, then shows the app proving it. Everything on screen is **English → Spanish**: an English talk, Spanish captions.

Rules for every story:

- Total 2:30–3:00; each chapter 20–30 s.
- Slide copy in **English** (the captions shown are Spanish; the slides explain them): title ≤ 12 words, body ≤ 25 words, at most one number per slide.
- A slide is never a static card: it is a side panel / lower third **over footage of the app recorded for that chapter**.
- Every number comes from a measured run (F17/F19 output files) or a cited list price (`docs/pricing.md`). No invented numbers.
- Attendee views use `?lang=es` on an English talk; the dashboard shows real rooms.
- `npm run demo-video` builds it end to end. The only manual part is the desktop capture of F16.3, done once by a human.

## Stories

### [x] F16.1 · Chapter frame
As the team, we want every chapter to share one look, so the video reads like a pitch and not like a screen recording.

- `scripts/demo-video.ts` gets a `chapter({ kicker, title, body, footage })` scene: the explanation panel (prototype tokens: `#0B0C0E` ground, `#FFD24A` kicker) over the chapter's footage for ~4 s, then the footage full screen.
- Kickers = the criteria as the judges name them: "Deployment & operation", "Quality", "Latency", "Scalability", "Innovation", plus "Price".
- Opening (≤ 4 s): name, one-liner, "Nerdearla Vibeathon 2026". Closing (≤ 5 s): repo URL, "MIT", "one Gemini API key".
- The old F15.2 scene list is replaced. `--replay` stays (no quota while recording).

**Verify:** `npm run demo-video -- --replay` produces an mp4 with the chapters in the order above, each panel over moving footage.

### [x] F16.2 · The talk: English in, Spanish out

> **Done 2026-09-25:** `demo/talk.mp4` (FOSDEM 2025, CC BY, 40 s) → `demo/talk.es.vtt` / `talk.es.mp4` by `npm run clip` (14 phrases, translation p50 912 ms), plus `talk.transcript.json` for the replay. See the licence note in `docs/decisions.md`.
As a judge, I want to see a real talk subtitled by the system from English into Spanish.

- A real English talk (a Nerdearla talk in English, or a public English tech talk whose license allows it) cut to 30–40 s: `npm run clip -- <url> --from=… --to=… --src-lang=en --lang=es`. The Spanish VTT the pipeline produced is burned in.
- It is the opening "result" shot and the footage behind the Quality and Latency panels.

**Verify:** `demo/clip.es.mp4` and `demo/clip.es.vtt` exist, and the subtitles are the pipeline's Spanish output (not hand-edited).

### [ ] F16.3 · Deploy & operation: from the .exe to captions

> **Script ready, capture pending a human** (`npm run rec:desktop`, see the TODO in `docs/decisions.md`). The operation half (alert with its button, talk switch) is in the video already; the Deploy chapter falls back to the wizard recorded by Electron until `demo/deploy.mp4` exists.
As a judge, I want to see that installing and running it is a double click and two pastes.

- The real thing on Windows: double-click the installer `.exe` → the app opens the setup wizard → paste the Gemini API key → "Test" ✓ → dashboard password → rooms live → first Spanish caption on the phone view.
- `npm run rec:desktop -- --seconds=90 --out=demo/deploy.mp4`: ffmpeg `gdigrab` desktop capture (ffmpeg-static supports it on Windows) while a human does the clicks. The script trims dead time and speeds up the installer progress (×4, with a visible "×4" badge).
- On-screen stopwatch: "From double-click to captions: N s", N measured from the capture.
- Panel copy: no terminal, no server, the key stays on your machine, or `docker compose up`.
- Second half, operation: the dashboard during an event — an alert in plain language with the button that fixes it (force one with `/api/dev/state?stage=…&state=no_signal` in fake mode), the talk switch at the scheduled time.

**Verify:** the chapter shows the real installer and wizard; the stopwatch value matches the capture.

### [x] F16.4 · Quality: context from the talk title

> **Done 2026-09-25:** `npm run ab` on a technical stretch of the FOSDEM talk → one real line where the glossary changes the Spanish caption ("K8s" → "Kepler"), shown verbatim on the panel; outputs in `demo/ab/`. Details in `docs/decisions.md`.
As a judge, I want proof that technical terms come out right.

- Panel: "We give it context: from the talk's title and abstract, Gemini builds the vocabulary it listens for and the glossary it translates with."
- Footage: paste the agenda → talks with their vocabulary; the Talk tab counting hits live ("Kubernetes ✓ 9"); the phone in Spanish with technical terms kept (do-not-translate list).
- A/B proof: the F16.2 clip run twice — empty glossary vs generated glossary — and a slide with 2–3 real lines where a term differs. Outputs kept in `demo/ab/`. If no line differs, show the hit counts instead and log it in `docs/decisions.md`.

**Verify:** the A/B lines on screen exist verbatim in the two runs' outputs.

### [x] F16.5 · Latency: watch it translate

> **Done:** split screen built by `demo-video` — the clip (audio) on the left, the phone in Spanish on the right, the clip's room started on the same clock (audio offset measured, 0.45 s); in `--replay` the room replays `demo/talk.transcript.json` with the recorded timing. Panel numbers from `bench/latency-2026-09-25T11-19-19.json`.
As a judge, I want to see how long a Spanish caption takes after the speaker says it.

- Live split screen: left, the English talk playing with its audio; right, the phone in Spanish (original live line visible), both started on the same clock so the delay on screen is the real one. The talk's audio is muxed at the same offset as the stage's start.
- The phone's latency badge ("~1.4 s") visible; panel with the F17 benchmark: end of speech → Spanish caption p50 / p95.

**Verify:** stepping through frames, each caption appears on the right within the benchmark's p95 after the phrase ends on the left.

### [x] F16.6 · Scalability: many rooms, one process

> **Done:** 8 rooms live on the dashboard; the two lower thirds read `bench/scale-2026-09-25T04-20-25.json` (11 ms p95, 44 % of one core, 157 MB), all in `docs/scale.md` / README.
As a judge, I want to believe it runs a whole conference.

- Footage: dashboard with the F19.1 rooms live (≥ 6), cards updating, total viewers.
- Panel numbers (F19): 1 speech session per room, not per language or viewer; viewers add zero AI cost; 2,000 viewers on one room delivered within ~65 ms (existing `npm run load`); N rooms in one process with its CPU/RAM (F19.2).
- One line on scaling out: `web` replicas behind a CDN, same image.

**Verify:** every number on the panel appears in `docs/scale.md` or the README.

### [x] F16.7 · Innovation: what else it does

> **Done:** montage of 7 items, each recorded working (job card with the subtitled clip, OBS overlay, "what did I miss?" sheet, agenda-driven talks, room station, TV mode with QR, stream-delay sheet).
As a judge, I want the extras that go beyond captions.

Montage, 3–4 s per item, each with a one-line label, each shown working:

- Subtitle a video: upload it, get it back with Spanish subtitles burned in (F18).
- OBS overlay over a stream (F12.2); a YouTube or stream link as the audio source (F02.2).
- "What did I miss?": summary of the last 5 minutes (F13.2).
- Paste the agenda → rooms, talks, vocabulary and the "move to the next talk?" alert (F10).
- Room-laptop microphone as a source (F08), TV mode with QR (F12.1), stream-delay mode (F07.6), SRT/VTT/TXT downloads (F13.1), demo mode without a key (F01).

**Verify:** every item appears working, not only named.

### [x] F16.8 · Price: compared with the market

> **Done:** the panel is generated from `docs/pricing.json` (same figures as `docs/pricing.md`): estimate, measured lower bound, Live Translate, OpenAI, the Nerdearla day, the audience line and the footnote with the date.
As a judge, I want to know what it costs next to the alternatives.

- Slide: cost per room-hour with Spanish + Portuguese — Everyone Makes Subs (measured, F19.3) vs Gemini Live Translate and OpenAI realtime translate (list price × 2 languages); commercial captioning or human interpreters only with a public, cited price. Plus the "Nerdearla day" row (10 rooms × 9 h).
- "The audience adds no cost: 10 or 10,000 viewers cost the same."
- Small footnote on the slide: "List prices as of <date>, see docs/pricing.md".

**Verify:** each figure matches `docs/pricing.md`.

### [x] F16.9 · Publish

> **Done 2026-09-25 09:50 ART:** `EveryoneMakesSubs-pitch.mp4` (2:38) and `fosdem-2025-kubernetes-emissions-clip.es.vtt` uploaded to Release v1.0.0; README and `docs/devpost.md` link to them; the old demo video stays as the fallback.
As the team, we want the new video to be the one judges find.

- Upload the mp4 and the clip's Spanish VTT to the Release; update the README video link and Devpost. Keep the old video only as a fallback.

**Verify:** the README links to the new video and it plays.
