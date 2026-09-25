# F12 · Room screen and OBS overlay

**Priority:** P1 (US1) · P2 (US2) · **Lane:** frontend · **Depends on:** F05.2 · **Prototype:** "Room screen" and "OBS overlay" tabs

**Goal:** captions on the room's screen and on the stream, with no technical setup.

## Stories

### [x] F12.1 · TV mode
As a room, I want a screen with giant captions and a QR so people can take them on their phones.

- `/s/:id/tv?lang=&qr=1`: black background, small header (stage, talk and speaker), 2 giant lines at the bottom (the upper one gray, the current one white; in the original language, plus the live line).
- Budget of ~60 characters per line, showing the tail of the text cut at a word boundary. Never more than 2 lines.
- Corner QR with "Captions in your language" pointing to `publicUrl/s/:id`.
- Break: screen with the next talk and its time.

**Verify:** at 1920×1080 it looks like the prototype.

### [ ] F12.2 · OBS overlay
As the streaming team, I want to paste a URL into OBS and get captions over the video.

- `/s/:id/overlay?lang=&lines=&size=&pos=&box=`: transparent background, text with shadow or a dark box, ~42 characters per line.
- In the dashboard (Share → Configure overlay): the prototype's configurator with live preview, which builds the URL with "Copy".
- Note with the recommended OBS delay (3 s).

**Verify:** add the URL as a Browser Source in OBS (or open it over a colored background) and see clean text.
