# F09 · Production dashboard

**Priority:** P1 · **Lane:** frontend (+ `/api/admin/metrics` on the backend) · **Depends on:** F05 · **Prototype:** "Dashboard" tab · **Architecture:** "Metrics"

**Goal:** the operator sees at a glance which stage needs attention and fixes it without engineering knowledge.

## Stories

### [ ] F09.1 · Password login
As an operator, I want only the production team to control the stages.

- `/admin` asks for the password (set in F11.2 or via `ADMIN_PASSWORD`) and sets a signed `httpOnly` cookie.
- Every admin route requires the cookie. From `127.0.0.1` with no password configured, access is direct.

**Verify:** in an incognito window, `/admin` asks for the password and admin routes return 401.

### [ ] F09.2 · One card per stage
As an operator, I want to see each stage's state and the last thing written.

- Card grid: name, plain-language state with color (Live, No audio, Delayed, Break, Stopped, Error), mini VU meter, **last transcribed line** (live one in gray), current and next talk, "N reading" and delay.
- `GET /api/admin/metrics` (SSE, every 1 s): state, level, last line, p50/p95, lag, rotations, errors, viewers and estimated cost per stage.
- Header: event name, total viewers, stages live, public address with "Copy" and "Print QR codes for all stages".
- "Technical details" toggle: shows p50/p95, rotations, errors and US$/h on each card.

**Verify:** with 2 fake stages, the cards update live.

### [ ] F09.3 · Alerts you can act on
As an operator, I want problems to come with the button that fixes them.

- Alert bar at the top: no audio > 30 s ("How to fix it" → Audio tab), p95 delay > 6 s, errors > 3/min, talk about to start (handled by F10.3) and public access down (F11).
- Alerts clear on their own once the problem is solved.

**Verify:** stop the source of a fake stage and watch the alert appear and disappear.

### [ ] F09.4 · Stage details
As an operator, I want everything about a stage in one place.

- Side panel with tabs:
  - **Talk:** now/next, "Move to next talk", vocabulary with counters (F10.4) and corrections.
  - **Audio:** chosen source and the station link/QR.
  - **Share:** attendee QR, TV link and overlay configurator.
  - **Downloads:** F13.1.
  - **Technical:** p50/p95 for original and translation, lag, rotations, reconnects, 429s, model and cost.

**Verify:** open the panel for each fake stage and go through the tabs.

### [ ] F09.5 · Create and edit stages
As an operator, I want to add a stage and choose where the audio comes from, in plain language.

- "Add stage": name + source, with plain-language options: "Room laptop (recommended)", "YouTube or stream link", "Audio file" (upload) and "Advanced: OBS or console via RTMP/SRT".
- Edit, start, stop and delete (delete asks for confirmation).

**Verify:** create a stage with an uploaded file and see it running.
