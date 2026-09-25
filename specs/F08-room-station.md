# F08 · Room station

**Priority:** P1 · **Lane:** frontend (UI) + backend (WS ingest) · **Depends on:** F05 · **Prototype:** "Room station" tab · **Architecture:** "1. AudioSource → Room station"

**Goal:** the room tech sends the mixing console's audio with a laptop and a link, without knowing what RTMP is.

## Stories

### [x] F08.1 · Pick the input and see the level
As a room tech, I want to choose the audio input and see that sound is coming in.

- `/station/:id?key=<stationKey>` asks for microphone permission and lists inputs (`enumerateDevices`).
- `getUserMedia` with `echoCancellation`, `noiseSuppression` and `autoGainControl` off.
- Large 30-bar VU meter (green, amber, red).
- Remembers the chosen input.

**Verify:** on `localhost`, pick the microphone and see the meter move.

### [ ] F08.2 · Send the audio
As a room tech, I want the audio to get through even if the network hiccups.

- An `AudioWorklet` downsamples to 16 kHz, converts to Int16 and sends binary over `WS /api/stages/:id/ingest?key=`.
- The server validates `stationKey` and uses the WS as an `AudioSource` (`kind: 'station'`).
- In the browser: 10 s buffer and reconnect with backoff. Status: "Sending audio to Everyone Makes Subs · for X min".
- Wake Lock, and a "Don't close this tab" warning if the tab goes to the background.
- `stationKey` is generated when the stage is created and goes in the dashboard's link/QR.

**Verify:** speak into the mic and see captions on `/s/:id`. Cut Wi-Fi for 5 s: those seconds of audio still arrive.

### [ ] F08.3 · Confirm it's the right input
As a room tech, I want to see what the system is writing, to know the right room is coming in.

- "What's being written" box with the live line or the last phrase (from the stage's SSE).
- "Test audio (5 s)": measures the average level and answers "We hear you fine ✓" or "Too quiet: turn up the gain".

**Verify:** with low audio, the test catches it.
