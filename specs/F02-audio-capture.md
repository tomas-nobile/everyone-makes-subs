# F02 · Audio capture

**Priority:** P0 (MVP) · **Lane:** backend · **Depends on:** F01 · **Architecture:** "1. AudioSource", "2. Meter / VAD"

**Goal:** every source ends up in the same stream: PCM s16le, mono, 16 kHz, 100 ms chunks, with a reliable clock.

## Stories

### [x] F02.1 · Real-time file
As an operator, I want to use an audio file as a source, to test or caption a recorded talk.

- `AudioSource` with `kind: 'file'` spawns `ffmpeg -re -i <file> -f s16le -ac 1 -ar 16000 pipe:1` (ffmpeg from `ffmpeg-static`).
- Emits chunks of exactly 3,200 bytes. The remainder stays buffered for the next chunk.
- `audioClock` = bytes read / 32,000 (seconds), exposed as `source.clock`.
- `loop: true` restarts at the end.

**Verify:** a script that plays `samples/es.mp3` and prints the clock every second: it advances about 1 s per second.

### [ ] F02.2 · YouTube link or URL
As an operator, I want to paste a stream link to caption it without cables.

- `kind: 'url'`: for YouTube, `yt-dlp -f bestaudio -g <url>` resolves the direct URL. Anything else goes straight to ffmpeg.
- `-re` only for VOD (if yt-dlp reports `is_live`, it isn't used).
- yt-dlp is looked up in `PATH` or `data/bin/`. If missing, the standalone binary is downloaded on first use.

**Verify:** a Nerdearla talk on YouTube produces chunks for 30 s.

### [x] F02.3 · Level and silence
As the system, I need to know when there's speech to rotate sessions, save audio and drive the VU meter.

- `meter.ts`: RMS per chunk, normalized 0–1.
- Silence = RMS below threshold for more than 400 ms. The threshold self-calibrates: 10th percentile of the last 30 s, ×2.
- Exposes `level`, `silentForMs` and `isSpeech`. Emits the `level` event 4 times per second.

**Verify:** vitest test with a zero buffer and a sine wave: silence and speech detected.

### [x] F02.4 · Source goes down
As an operator, I want the system to retry on its own and tell me when the source drops.

- If ffmpeg exits or sends no data for 5 s: state `no_signal` and restart with backoff (1, 2, 4… up to 30 s).
- When data comes back: state `live`.
- Stopping the stage kills the child process without leaving zombies.

**Verify:** kill the ffmpeg process by hand and see the restart and state changes in the log.
