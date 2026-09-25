# Pricing: this pipeline vs the market (F19.3)

Everything the Price chapter of the video (F16.8) shows comes from this file, and this file is generated from the same figures as [`pricing.json`](pricing.json) (the video reads the JSON). List prices as of **2026-09-24**; a measured row replaces the estimate once `npm run cost` has run on a real key (see below).

## Per room-hour

| | Spanish only | Spanish + Portuguese | Basis |
|---|---|---|---|
| **Everyone Makes Subs** (Gemini 3.5 Transcribe Live + Flash-Lite, one call for every language) | **US$ 0.77** | **US$ 0.82** | list-price estimate, see assumptions |
| Everyone Makes Subs, **measured** (1 room, 5 min, `npm run cost`) | US$ 0.61 | US$ 0.65 | lower bound: 60 audio min + 95.8k / 34k tokens per room-hour; the token count is incomplete for streamed calls (see below) |
| Gemini 3.5 Live Translate (speech → speech, one session per language) | US$ 2.21 | US$ 4.42 | US$ 0.0368/min per language |
| OpenAI `gpt-realtime-translate` (one session per language) | US$ 2.04 | US$ 4.08 | US$ 0.034/min per language |

**A Nerdearla day** (10 rooms × 9 h = 90 room-hours, Spanish + Portuguese): **US$ 74** with this pipeline · US$ 398 with Live Translate · US$ 367 with OpenAI.

**The audience adds no cost:** every room is transcribed and translated once and fanned out over SSE; 10 or 10,000 viewers cost the same (see [`scale.md`](scale.md)).

Commercial captioning services and human interpreters are not in the table: none of them publishes a per-hour list price we could cite, and an uncited number would be an invented one.

## How the estimate is built

- Transcription: 60 min of audio per room-hour × US$ 0.009/min (Google's "effective blended rate" for `gemini-3.5-transcribe-live`: US$ 0.005/min audio in + US$ 0.004/min text out). Silences over 2 s are not sent, so a real hour is cheaper.
- Translation: ~720 calls per hour (one phrase every ~5 s), ~800 input tokens each (prompt, glossary, the last 3 phrases as context) and ~30 output tokens per language, at `gemini-3.5-flash-lite` list prices (US$ 0.30 / 1M in, US$ 2.50 / 1M out). Every target language comes back from the same call, so the input is paid once: US$ 0.17 + US$ 0.054 per language.
- Vocabulary, agenda and the "what did I miss?" summary: one call per talk / per paste / per room per minute, negligible next to the above.

## Measured (`npm run cost`)

`npm run cost -- --rooms=2 --minutes=10` runs K rooms on the real pipeline (samples looping), reads the audio minutes sent and the translation tokens (`usageMetadata`) from the dashboard metrics, and prints US$ per room-hour at the list prices above. The row is written to `bench/cost-<timestamp>.json` and copied here:

| Run | Rooms | Minutes | Audio min / room-hour | Tokens in / out per room-hour | US$ / room-hour (es) | US$ / room-hour (es + pt) |
|---|---|---|---|---|---|---|
| 2026-09-25 11:41 UTC (`bench/cost-2026-09-25T11-41-56.json`) | 1 | 5 | 60.0 | 95,811 / 33,984 | 0.61 | 0.65 |

The audio side (60 min × US$ 0.009 = US$ 0.54) is the whole story; translation tokens add ~US$ 0.11. Treat the token part as a lower bound: `usageMetadata` arrived for only some of the streamed translation calls during the run (the per-minute counts jumped from ~450 to ~5,000 input tokens), so the estimate row above, built from the prompt size, stays the headline figure and the video quotes it. The ordering of the comparison does not depend on which row you pick: both are 3–6× below the per-language speech-to-speech services.

## Sources

- Gemini API pricing (Transcribe Live, Live Translate, Flash-Lite): https://ai.google.dev/gemini-api/docs/pricing — figures quoted on 2026-09-24 (the same page describes the free tier as "free of charge", with the data-use caveat in the README).
- OpenAI API pricing (`gpt-realtime-translate` US$ 0.034/min): https://openai.com/api/pricing/ — as recorded in `docs/market/analysis.md` §2 on 2026-09-24 (the page refused an automated fetch on 2026-09-25; re-check by hand before quoting elsewhere).
