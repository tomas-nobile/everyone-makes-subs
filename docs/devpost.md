# Devpost submission (paste-ready)

**Name:** Everyone Makes Subs

**Tagline:** Live captions and translation for every stage of your conference, with a single Gemini API key.

**Links**
- Repo: https://github.com/tomas-nobile/everyone-makes-subs
- Installer (Windows) and videos: https://github.com/tomas-nobile/everyone-makes-subs/releases/tag/v1.0.0
- Video: https://github.com/tomas-nobile/everyone-makes-subs/releases/download/v1.0.0/EveryoneMakesSubs-pitch.mp4 (2:30, one chapter per judging criterion: Deploy → Quality → Latency → Scalability → Innovation → Price; English talk, Spanish captions). The earlier `EveryoneMakesSubs-demo.mp4` (1:52) stays in the release as a fallback.

## Inspiration

At a conference like Nerdearla, talks happen in parallel in Spanish and English, and part of the audience can't follow one language or the other. Human interpreters are expensive and the existing captioning tools take one stage at a time, need a developer, or charge per viewer.

## What it does

Every room of the event gets live captions and translation, and every attendee reads them on their own phone, in their own language:

- **Attendees** scan the room's QR code. The phone picks their language, shows the speaker's words as large captions (original or translated to es/en/pt), a "speaking…" indicator, the history, and a "What did I miss?" summary.
- **The operator** (someone from the production team, not a developer) installs one app, pastes a Gemini key, pastes the agenda from the event website and connects each room. A dashboard shows every room in plain language (Live, No audio, Delayed) with the last line written and alerts that come with the button that fixes them.
- **The room tech** opens a link on the laptop connected to the mixing console and picks the input. YouTube/stream links, audio files and RTMP/SRT (OBS) also work.
- **Room screens** get a TV mode with two giant lines and a QR code; **the stream** gets a transparent OBS overlay.
- **After the talk**, SRT/VTT/TXT exports are ready for YouTube.

## How we built it

Node + TypeScript + Fastify on the server, React on the web, Electron for the installer, Docker for servers. Per room: audio (ffmpeg, yt-dlp or the browser station) → **Gemini Live** transcription → a phrase segmenter → **one Gemini Flash-Lite call per phrase** that returns every language as JSON → one SSE stream per room with all languages. Each room is processed once, so the AI cost depends on rooms × hours, never on the audience (2,000 viewers on one stage: +67 MB of RAM).

It was vibe-coded in one night with Claude Code: one spec file per feature with user stories and acceptance criteria, a backend agent and a frontend agent working in parallel on `main` against a fake backend that replays real transcripts, and every decision logged in `docs/decisions.md`.

## Challenges we ran into

Everything we learned from the real API is in `docs/decisions.md` (`LIVE-API:` lines):
- The Live API keeps one utterance open for as long as the speaker doesn't pause (90 s in our samples) and keeps revising earlier words. Phrases are therefore cut from the interims (LocalAgreement on the uncommitted tail, located by word alignment), not from the finals.
- Sessions last about 10 minutes, so they rotate make-before-break at a pause. A fresh session can take 15–20 s to produce text, while the old one returns its final within a second of `audioStreamEnd`: the new session's output is held until then. Verified with forced rotations every 30 s: same text, 0 duplicates, 0 gaps.
- The ASR latency varies (from half a second to a minute on the free tier), so subtitle exports re-time each utterance's phrases over its real audio span.
- Free-tier quotas (15 requests/minute per model): a second model takes over on a 429, and under load several phrases go in one request.

## Accomplishments that we're proud of

- A non-developer can run it: installer, setup wizard, pasted agenda, plain-language dashboard.
- Technical vocabulary per talk, generated from the title and abstract and visibly working ("Kubernetes ✓ 2").
- Honest latency: the dashboard shows the measured delay and says "Delayed" when it is.
- The demo video's English subtitles were produced by the system itself.

## What we learned

Measure the real API before designing around it: our first segmenter assumed short utterances with finals, and the real stream proved otherwise.

## What's next

A billed project for real events, Opus compression for the station audio, `web` replicas behind a CDN, and a local model (Gemma) for offline events.

## Built with

gemini-live, gemini-flash-lite, typescript, node.js, fastify, react, vite, electron, ffmpeg, yt-dlp, docker, server-sent-events
