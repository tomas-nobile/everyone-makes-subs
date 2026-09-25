# F17 · Latency to the max

**Priority:** P0 · **Lane:** backend (+ one line in `web/`) · **Depends on:** a real key (paid tier for the measurements: free-tier 429 waits pollute p95)

**Target** (one room, `samples/en.mp3`, English → Spanish): end of speech → Spanish caption on the phone **p50 ≤ 1.5 s, p95 ≤ 3 s**; original confirmed **p50 ≤ 1 s**. A change stays only if the benchmark improves; the final numbers go to the README and the video (F16.5).

Where we are (`docs/architecture.md` §2–5, `docs/decisions.md`):

- Commits: sentence end with ≥ 5 words, ≥ 8 words at a comma, or forced after `FORCE_COMMIT_MS` = 4.5 s; phrases ≤ 18 words.
- Finals come only from the ASR's own endpointing: `audioStreamEnd` is sent on rotation only (no hybrid VAD).
- One translation call per commit with every target language in one JSON; translation p50 1.34 s measured.
- `tr` events replace the whole record (StageManager and `useStageStream`).

## Stories

### [ ] F17.1 · Latency benchmark (baseline first)
As the team, we want one command that measures real end-to-end latency, so each optimization is measured, not guessed.

- `npm run bench:latency [-- --file=samples/en.mp3]`: runs the real pipeline in real time (`runFile`) and logs per phrase: end of speech (t1, audio clock) → `segment` published → `tr.es` published → received by an SSE client. Prints p50/p95/max for original, Spanish and delivery; writes `bench/latency-<timestamp>.json`.
- The baseline goes to `docs/decisions.md` before any change; each later story adds its before → after line.

**Verify:** two consecutive runs agree within ~15% on p50.

### [ ] F17.2 · Hybrid VAD: close the phrase on the pause
As an attendee, I want the caption as soon as the speaker pauses, not when the ASR decides.

- When the local VAD sees ≥ 500 ms (`VAD_END_MS`) of silence after speech, send `audioStreamEnd` so the session emits the final right away; keep sending audio when speech resumes (F03.1 verified audio after `audioStreamEnd` is accepted).
- Never during a rotation swap, never twice for the same pause.
- Tune 400 / 500 / 700 ms with the benchmark and watch for sentences split in two.

**Verify:** original p50 improves on the baseline; the transcript has no duplicated or lost words (diff against the baseline text).

### [ ] F17.3 · Commit sooner
As an attendee, I want shorter waits on long sentences.

- Segmenter thresholds chosen with the benchmark: sentence end ≥ 3 words (was 5), comma cut ≥ 6 words (was 8), `FORCE_COMMIT_MS` ~2.5 s (was 4.5), `MAX_PHRASE_WORDS` ~12 (was 18). Keep the combination with the best p50 whose fragments still translate well (spot-check 20 phrases).
- One vitest case per changed threshold; the segmenter tests stay green.

**Verify:** before → after in `docs/decisions.md`.

### [ ] F17.4 · Spanish first
As a Spanish-speaking attendee, I want my language not to wait for the others.

- Each commit gets a dedicated `es` call: short prompt (title, the glossary terms that appear in the phrase, last 2 phrases), schema with only `es`, few output tokens, published as soon as it returns. The other languages keep the current call, in parallel.
- `tr` events become partial: StageManager and `useStageStream` **merge** `tr` by `seq` instead of replacing. Log a `CONTRACT:` line ("`tr` may carry a subset of languages; clients merge by seq").
- A talk already in Spanish makes no `es` call (as today).

**Verify:** Spanish p50 improves; `en`/`pt` still fill on the phone.

### [ ] F17.5 · Faster calls
As the team, we want no time lost between us and Gemini.

- Pre-warmed, kept-alive connection to the Gemini API (a tiny request when the stage starts) so the first phrases pay no handshake.
- Try `generateContentStream` for the `es` call; keep it only if p50 drops, otherwise revert and log it.
- Pick the `es` model by p50 with `bench-mt` (3.5 vs 3.1 flash-lite) at acceptable quality.
- Translation concurrency configurable (2 → 4 on the paid tier); batching only when the queue is deeper than the concurrency (as today).

**Verify:** `bench-mt` and `bench:latency` before → after lines.

### [ ] F17.6 · Delivery without buffering
As an attendee, I want the phone to show a caption the moment the server has it.

- SSE route: `setNoDelay(true)` on the socket, no compression, every event written at once.
- The phone renders a `tr` as soon as it arrives (no batching or animation delay in `Caption`).

**Verify:** the benchmark's delivery column (publish → client) p95 < 50 ms on the LAN.

### [ ] F17.7 · Report
As a judge, I want the latency claim backed by numbers.

- README "Latency" section: final p50/p95 for original and Spanish, the method and the machine/tier; the same numbers feed F16.5.

**Verify:** the README numbers equal the last `bench/latency-*.json`.
