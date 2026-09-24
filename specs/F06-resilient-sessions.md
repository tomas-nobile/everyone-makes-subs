# F06 · Sessions that don't drop

**Priority:** P1 · **Lane:** backend · **Depends on:** F03 · **Architecture:** "3. TranscribeSession → Rotation", "1. AudioSource → Robustness rules"

**Goal:** 60-minute talks without gaps even though the Live API closes every ~10 minutes. This is what separates a demo from a system.

## Stories

### [ ] F06.1 · Rotation on silence
As an attendee, I don't want to notice the system switching connections every 9 minutes.

- At `SESSION_ROTATE_SEC − 5` the next session pre-connects.
- From `SESSION_ROTATE_SEC` on, at the first silence of 400 ms or more, swap: `audioStreamEnd` to the old one, audio goes to the new one, and the old one's finals keep flowing until it closes (3 s timeout).
- If there was no silence by `SESSION_HARD_CUT_SEC`: swap with 2 s of overlap and `align.trimOverlap` on the new session's first final.
- `requestRotation()` (used by F10) swaps at the next silence.
- Rotation count and max gap are recorded.

**Verify:** with `SESSION_ROTATE_SEC=60`, a 5-minute file has 4 rotations with no visible gaps.

### [ ] F06.2 · Reconnection
As an operator, I want the system to recover on its own if Gemini drops the connection.

- `GoAway`, unexpected `onclose` or an error → immediate reconnect with backoff (max 30 s), replaying the 30 s ring buffer.
- If the backlog exceeds 10 s, silent chunks are dropped to catch up with the speaker. State `degraded` meanwhile.
- More than 3 errors per minute → `degraded`.

**Verify:** close the session by hand mid-file: it comes back on its own and no phrases are lost.

### [ ] F06.3 · Rotation test
As the team, we want a repeatable check that rotation neither duplicates nor drops phrases.

- A test (with the fake backend extended to simulate session closes) that compares the concatenated segments with the reference transcript: 0 duplicates, 0 gaps longer than 1 word.

**Verify:** `npm test -- rotation` passes.
