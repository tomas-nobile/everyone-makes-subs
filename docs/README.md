# Everyone Makes Subs · Features and status

`/feature F04` implements a whole feature; `/feature F04.2`, a single story. `/next` says what's next. When a story is done it's marked `[x]` here and in its file.

**MVP** = F01.1–2 + F02.1 + F03.2 + F04.1–3 + F05.1–2 + F07.1–2: 2 stages in parallel with original and translation on the phone.

## Plan (from 00:00 on Sept 25, ART)

| Time | Backend lane | Frontend lane (against `dev:fake`) |
|---|---|---|
| 00:00–00:30 | F01.1, F01.2 | F01.4 (release pipeline) |
| 00:30–01:30 | F02.1, F02.3, **F03.1 (spike)** | F07.1, F07.2 |
| 01:30–02:30 | F03.2, F04.1, F04.2, F04.3 | F07.3, F07.4 |
| 02:30–03:15 | F05.1, F05.2 → **MVP with a real key** · commit · push | F07.5 |
| 03:15–06:15 | Sleep | Sleep |
| 06:15–07:30 | F06.1, F06.2, F04.4, F05.3, F02.2 | F09.1, F09.2, F09.3 |
| 07:30–09:00 | F08.2, F10.1, F10.4, F11 (backend) | F08.1, F08.3, F09.4, F09.5, F11.1–3 (UI), F12.1 |
| 09:00–10:00 | F14.1, F13.1, F06.3 | F14.2, F12.2, F07.6 |
| 10:00–11:00 | F15.2 (video) | F15.1 (README) |
| 11:00–11:45 | F15.3 · **submit** | Buffer |

If there's time left: F10.2, F10.3, F11.4, F13.2, F14.3, F02.4, F01.3 (if the samples are still placeholders).

## Cut order (if we're behind, cut from the top down)

F13.2 → F10.2 → F10.3 → F11.4 → F14.3 → F14.2 → F12.2 → F07.6 → F08.3 → F09.5 (stages via `DEMO=1`)

**Never cut:** the MVP, F06.1, F09.2, F15.

## Pitch round (Sept 25, from 00:30 ART)

The video is rebuilt around the judging criteria (F16) and shows **English → Spanish**. Order, two lanes:

| Backend lane | Frontend / scripts lane |
|---|---|
| F17.1 (baseline) → F17.2 → F17.4 → F17.3 → F17.5 → F17.6 → F17.7 | F19.1 → F16.1 → F16.2 (English talk → Spanish clip) |
| F18.1 → F19.2 → F19.3 | F18.2 → F16.3 (desktop capture, needs a human) → F16.4–F16.8 |
| | F16.9 + F15.3 · **submit by 11:45** |

**Cut order (from the top):** F18.3 → F17.5 → F19.2 (use the existing 2,000-viewer number) → F16.4 A/B lines (show vocabulary hits only) → F18.2 (show F18 via the CLI) → F19.3 measured row (use the list-price estimate, labeled as such).

**Never cut:** F17.1, F17.2, F16.1–F16.3, F16.5, F16.9.

## Status

| Feature | Priority | Stories |
|---|---|---|
| [F01 · Skeleton and no-key mode](../specs/F01-skeleton.md) | P0 | [x] .1 · [x] .2 · [x] .3 · [x] .4 |
| [F02 · Audio capture](../specs/F02-audio-capture.md) | P0 | [x] .1 · [x] .2 · [x] .3 · [x] .4 |
| [F03 · Live transcription](../specs/F03-live-transcription.md) | P0 | [x] .1 · [x] .2 |
| [F04 · Segmentation and translation](../specs/F04-segmentation-translation.md) | P0 | [x] .1 · [x] .2 · [x] .3 · [x] .4 |
| [F05 · Parallel stages and broadcast](../specs/F05-stages-broadcast.md) | P0 | [x] .1 · [x] .2 · [x] .3 |
| [F06 · Sessions that don't drop](../specs/F06-resilient-sessions.md) | P1 | [x] .1 · [x] .2 · [x] .3 |
| [F07 · Attendee view](../specs/F07-attendee-view.md) | P0/P1 | [x] .1 · [x] .2 · [x] .3 · [x] .4 · [x] .5 · [x] .6 |
| [F08 · Room station](../specs/F08-room-station.md) | P1 | [x] .1 · [x] .2 · [x] .3 |
| [F09 · Production dashboard](../specs/F09-dashboard.md) | P1 | [x] .1 · [x] .2 · [x] .3 · [x] .4 · [x] .5 |
| [F10 · Talks, schedule and vocabulary](../specs/F10-talks-vocabulary.md) | P1/P2 | [x] .1 · [x] .2 · [x] .3 · [x] .4 |
| [F11 · First-run setup](../specs/F11-first-run-setup.md) | P1/P2 | [x] .1 · [x] .2 · [x] .3 · [x] .4 |
| [F12 · Room screen and overlay](../specs/F12-tv-overlay.md) | P1/P2 | [x] .1 · [x] .2 |
| [F13 · Export and summary](../specs/F13-export-summary.md) | P1/P2 | [x] .1 · [x] .2 |
| [F14 · Packaging](../specs/F14-packaging.md) | P1/P2 | [x] .1 · [x] .2 · [x] .3 |
| [F15 · Submission](../specs/F15-submission.md) | P0 | [x] .1 · [x] .2 · [ ] .3 |
| [F16 · Pitch video by judging criterion](../specs/F16-pitch-video.md) | P0 | [x] .1 · [ ] .2 · [ ] .3 · [ ] .4 · [ ] .5 · [ ] .6 · [ ] .7 · [ ] .8 · [ ] .9 |
| [F17 · Latency to the max](../specs/F17-latency.md) | P0 | [ ] .1 · [x] .2 · [x] .3 · [ ] .4 · [ ] .5 · [ ] .6 · [ ] .7 |
| [F18 · Subtitle a video](../specs/F18-subtitle-a-video.md) | P1 | [x] .1 · [x] .2 · [x] .3 |
| [F19 · Scale and cost evidence](../specs/F19-scale-cost-evidence.md) | P1 | [x] .1 · [x] .2 · [ ] .3 |
