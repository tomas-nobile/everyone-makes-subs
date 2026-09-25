# F17 · Latency to the max

**Priority:** P0 · **Lane:** backend (+ one line in `web/`) · **Depends on:** a real key (paid tier for the measurements: free-tier 429 waits pollute p95)

**Target** (one room, `samples/en.mp3`, English → Spanish): pause → Spanish caption on the phone **p50 ≤ 1.5 s, p95 ≤ 3 s**; original confirmed **p50 ≤ 1 s**. The target is a stretch until the baseline exists — don't put a number in the F16 script before F17.1 has run. A change stays only if the benchmark improves; the final numbers go to the README and the video (F16.5).

Where we are (`docs/architecture.md` §2–5, `docs/decisions.md`):

- Commits: sentence end with ≥ 5 words, ≥ 8 words at a comma, or forced after `FORCE_COMMIT_MS` = 4.5 s; phrases ≤ 18 words. All literals inside `Segmenter.cutPoint`.
- Finals come only from the ASR's own endpointing: `audioStreamEnd` is sent on rotation only (no hybrid VAD).
- One translation call per commit with every target language in one JSON; translation p50 1.34 s measured. `CONCURRENCY = 2`, hardcoded.
- `tr` events replace the record in `StageManager` and `runFile`; the phone already **merges** them by `seq` (`useStageStream.applySeg`).
- **The current `lag` is not latency.** `segment.lag` is measured from `t1`, and `t1` is the last audio chunk read (mid-utterance commits) or the utterance end (every phrase split out of a long final) — so it reads ~0.1 s while the speaker keeps talking, whatever the pipeline does. This is the effect `decisions.md` describes as "commit times trail the speech by the ASR latency". The phone's "~1.4 s" badge shows the same number.
- A fresh ASR session takes 15–20 s to emit its first interim (`decisions.md`, F06.1).

## Stories

### [ ] F17.1 · Latency benchmark (baseline first)
As the team, we want one command that measures real end-to-end latency, so each optimization is measured, not guessed.

- `npm run bench:latency [-- --file=samples/en.mp3 --runs=3]`: boots the real server (`server/src/index.ts`, like `scripts/load-sse.ts` does) with one file-source stage, connects one SSE client, and times every phrase at four points: **heard** → `segment` published → `tr.es` published → received by the client. Reports p50/p95/max over the pooled runs (one run of `en.mp3` is ~40 phrases: its p95 is the second-worst sample) and writes `bench/latency-<timestamp>.json`.
- Two latencies, both honest, never averaged together:
  - **Pause → caption** (what the attendee feels): for utterances closed by a pause. "End of speech" is the audio clock of the last speech chunk before the silence, mapped to wall time by `StageWorker.wallAt` — exact to 100 ms. Before F17.2 this only covers the ASR's own endpointing; after F17.2 it is the clock recorded when `audioStreamEnd` is sent.
  - **Heard → caption** (our pipeline's own delay): for every phrase. "Heard" = wall time of the first ASR interim whose cumulative word count reached the phrase's last word. `StageWorker` records `firstSeenAt[wordCount]` on each `interim` and looks it up with `segmenter.committedCount` after the commit. Interims are cumulative and 98% of them extend the previous one, so word count is a good enough anchor.
- Under `BENCH=1` the worker stamps `segment`/`tr` with `at: Date.now()` (server wall clock) and `segment` with `heardAt`, so the client can compute publish → receive on the same machine. Log the `CONTRACT:` line (optional fields, bench only).
- Also reported, separately from p50/p95: **time to first caption** from stage start (the 15–20 s a judge sees when the demo starts) and phrases per minute (every extra commit is an MT call).
- Delivery column (publish → receive) doubles as the F17.6 check: p95 < 50 ms on the LAN means there is nothing to do there.
- The baseline goes to `docs/decisions.md` before any change; each later story adds its before → after line.

**Verify:** two consecutive 3-run benchmarks agree within ~15% on both p50s.

### [ ] F17.2 · Hybrid VAD: close the phrase on the pause
As an attendee, I want the caption as soon as the speaker pauses, not when the ASR decides.

- **Spike first (10 min):** F03.1 verified *one* `audioStreamEnd` followed by more audio; this story sends dozens per session. Run `spike-live.ts` sending `audioStreamEnd` at every ≥ 500 ms pause of `samples/en.mp3` and count finals, duplicated words and lost words. If the session degrades, fall back to `end()` + swap to the pre-connected `next` session (the rotation path) and log it.
- When the meter sees ≥ 500 ms (`VAD_END_MS`) of silence after speech, send `audioStreamEnd` so the session emits the final right away; keep sending audio when speech resumes. Send it in `Transcriber.push` **after** `flush()` so the ASR has every speech chunk first. Guards: speech was sent since the last end, `!holdNew` (a swap is in progress), the session is ready. Never twice for the same pause (reset the flag on `silentForMs === 0`).
- Record `vadEndClock` when sending and use it as `t1` in `emitFinal` (today `t1 = lastSpeech`, which has already advanced if the speaker resumed during the ~1 s the final takes). This is also the benchmark's exact end of speech.
- Tune 400 / 500 / 700 ms with the benchmark. Watch for sentences split in two: the meter's threshold climbs during loud intro music and quiet speech then reads as silence (`decisions.md` TODO) — today that costs nothing, with hybrid VAD it cuts a sentence.

**Verify:** pause → caption p50 improves on the baseline; the transcript has no duplicated or lost words (diff against the baseline text).

### [ ] F17.3 · Commit sooner
As an attendee, I want shorter waits on long sentences.

- Move the thresholds out of `cutPoint` into `SegmenterOptions` (`sentenceMinWords`, `commaMinWords`, `forceCommitMs`, `maxPhraseWords`) with env overrides, so the benchmark sweeps them without code edits.
- Candidates: sentence end ≥ 3 words (was 5), comma cut ≥ 6 (was 8), `FORCE_COMMIT_MS` ~2.5 s (was 4.5), `MAX_PHRASE_WORDS` ~12 (was 18). Keep the combination with the best heard → caption p50 whose fragments still translate well (spot-check 20 phrases) and whose phrases-per-minute stays reasonable.
- Expect a smaller gain than F17.2/F17.4: once pauses close utterances this only affects run-on speakers.
- One vitest case per changed threshold; the segmenter tests stay green.

**Verify:** before → after in `docs/decisions.md`, with phrases/min next to the p50.

### [ ] F17.4 · Spanish first
As a Spanish-speaking attendee, I want my language not to wait for the others.

- **One call, streamed, `es` first** — not a second call. The translation request keeps every target language but puts `es` first in the schema (`propertyOrdering`) and uses `generateContentStream`; as soon as the `"es":"…"` value closes in the streamed JSON, publish `tr { es }`; when the response completes, publish the rest. The `es` tokens are generated first either way, so Spanish latency equals a dedicated call, while RPM and cost stay flat (two calls per phrase would kill the free tier's 15 RPM and double the F19 cost number). Fallback if partial-JSON parsing eats the timebox: a dedicated `es` call in plain text (no JSON, fewer tokens), the other languages in the current call, in parallel.
- `tr` events become partial: clients already merge by `seq`; the server must too:
  - `StageManager`: merge `seg.tr`, and `persist` only when every `targetLangs` key is present (or on the 20 s timer / talk switch, as today). Today `persist` on the first `tr` deletes the seq from `pending` and writes the missing languages as `null` — a second `tr` would be lost and exports would carry `en/pt: null`.
  - `Metrics.onTr`: keep the first `ms` (the `es` one) — today the last write wins, so the dashboard would report the slow call.
  - `runFile`: merge, and count a segment as pending until all target languages are in.
  - `FakeBackend` keeps its single full `tr`.
- Log the `CONTRACT:` line ("`tr` may carry a subset of languages; clients merge by seq").
- A talk already in Spanish makes no `es` output (as today: the original is copied).

**Verify:** Spanish p50 improves; `en`/`pt` still fill on the phone; an exported `.srt` of the run has no `null` languages.

### [ ] F17.5 · Faster calls
As the team, we want no time lost between us and Gemini.

- **Keep the socket alive.** Node's `fetch` (undici) closes idle keep-alive sockets after 4 s unless the server sends a `Keep-Alive` hint; phrases arrive every 2–5 s and silences are longer, so calls re-do TLS to Google. Install a global dispatcher — `setGlobalDispatcher(new Agent({ keepAliveTimeout: 30_000, keepAliveMaxTimeout: 30_000 }))` from `undici` (Node's built-in fetch reads the same global) — plus one tiny warm request when the stage starts. A pre-warm alone helps only the first phrase.
- Pick the model by heard → caption p50 with `bench-mt` (3.5 vs 3.1 flash-lite) at acceptable quality. First update `bench-mt`: its phrases are Spanish → en/pt; the reference pair is English → Spanish.
- Translation concurrency configurable (`TRANSLATE_CONCURRENCY`, 2 → 4 on the paid tier); batching only when the queue is deeper than the concurrency (as today).
- Streaming by itself does not shorten a call — it only pays when partials are published, which F17.4 already does.

**Verify:** `bench-mt` and `bench:latency` before → after lines, including the keep-alive change on its own.

### [ ] F17.6 · Delivery without buffering (verification only)
As an attendee, I want the phone to show a caption the moment the server has it.

- Already the case, as far as the code says: Node's HTTP server defaults `noDelay: true`, no compression plugin is registered, the SSE route writes every event synchronously, and the phone renders `tr` on arrival (the `.cap` colour transition is a fade, not a delay).
- Act only if F17.1's delivery column shows p95 ≥ 50 ms on the LAN: then `setNoDelay(true)` on the socket, check the Vite proxy in dev, and look for React batching in `Caption`.
- The phone's "~1.4 s" badge uses the old `lag`. Either feed it the F17.1 definition or don't cite it in the video.

**Verify:** the benchmark's delivery column (publish → client) p95 < 50 ms on the LAN.

### [ ] F17.7 · Report
As a judge, I want the latency claim backed by numbers.

- README "Latency" section: final pause → caption and heard → caption p50/p95 for original and Spanish, time to first caption, the method (how "end of speech" and "heard" are defined), the machine and the tier. State that the numbers are on the LAN: attendees on phones go through Tailscale Funnel or the named Cloudflare tunnel, which adds its own hop. The same numbers feed F16.5.

**Verify:** the README numbers equal the last `bench/latency-*.json`.
