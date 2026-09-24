# F07 · Attendee view (phone)

**Priority:** P0 (US1–2, MVP) · P1 (US3–6) · **Lane:** frontend · **Depends on:** F01.2 (dev), F05.2 (real) · **Prototype:** "Phone" tab

**Goal:** scan the QR and be reading within 2 seconds, in your language, without touching anything.

## Stories

### [ ] F07.1 · Scan and read
As an attendee, I want to scan the QR and see that stage's captions in my language without choosing anything.

- `/s/:id` opens the SSE. The language comes from `?lang=` or else `navigator.language` (en/es/pt; if none match, the original).
- The last phrases show up immediately (from `hello`).
- Header: stage + "live", title, speaker, delay (`~1.4 s`) and a language button ("English · translation" / "Español · original").
- 6 s toast: "Showing English, your phone's language. Change".
- Wake Lock enabled if the browser supports it.

**Verify:** at 390 px it looks like the prototype with `npm run dev:fake`.

### [ ] F07.2 · Confirmed phrases and live line
As an attendee, I want to read the latest phrase large and know the system is alive.

- Phrase list: the last 2 in white, earlier ones in gray. Newest at the bottom.
- In the original language: gray live line with masking (the last unstable word is hidden).
- In a translation: "speaking…" bars driven by `level`, plus a small gray line with the live original (can be turned off).
- `tr: null` → the original is shown in gray.
- `kind: 'sound'` → "♪ applause" chip.
- `aria-live="polite"` only on the confirmed list.

**Verify:** switch between es and en with the fake and see both behaviors.

### [ ] F07.3 · Language and reading settings
As an attendee, I want to adjust how I read without losing the thread.

- Language sheet: each option in its own language, labeled "original" or "translation". Switching doesn't reconnect (the SSE carries every language).
- "Aa" sheet: size 18–44 px, "Show the original below" (bilingual), "Show the original while translating" and "Keep the screen on".
- Preferences saved in `localStorage` (wrapped in try/catch).

**Verify:** change language and size, reload, and they persist.

### [ ] F07.4 · History and back to live
As an attendee, I want to re-read something without the screen yanking it away.

- Scrolling up more than 40 px pauses autoscroll and shows "↓ Back to live · N new".
- Reaching the top loads 50 more phrases from `/history`.

**Verify:** scroll for 20 s with the fake and come back.

### [ ] F07.5 · States
As an attendee, I want to understand what's going on when there are no captions, without seeing errors.

- `paused` → "⏸ The speaker paused". `no_signal` → card "Waiting for audio from the room. Captions will come back on their own". Break (no talk running, a next one scheduled) → "Break · back at HH:MM" with the next talk. Talk ended → TXT/SRT downloads + summary. SSE down → "Reconnecting…" banner.
- Every text in all 3 languages.

**Verify:** force each state from the fake (`/api/dev/state?stage=&state=`, fake mode only).

### [ ] F07.6 · Delay for stream viewers
As someone watching on YouTube, I want captions to line up with the video.

- In "Aa": the "I'm watching the stream" toggle shows a 0–30 s slider (default 8 s). Phrases appear only once they've met the delay.
- The live line and the header delay are hidden in this mode.

**Verify:** at 8 s, phrases appear 8 s later than in another tab without delay.
