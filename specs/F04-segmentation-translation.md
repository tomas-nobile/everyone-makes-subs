# F04 · Segmentation and translation

**Priority:** P0 (MVP) · **Lane:** backend · **Depends on:** F03 · **Architecture:** "4. Segmenter", "5. Translator"

**Goal:** cut text into readable phrases and translate them into every language in 2–4 s, without anything "jumping".

## Stories

### [ ] F04.1 · Phrase cuts
As an attendee, I want text confirmed in short phrases, so I don't wait for the end of a long paragraph.

- `Segmenter.onInterim`: common word prefix of the last 2 interims (LocalAgreement-2) = stable text.
- Commit when the pending text: ends in `.?!;` with 5+ words; or has 8+ words and a comma or conjunction (cut there); or `FORCE_COMMIT_MS` (4,500) passed with 4+ words.
- `onFinal` commits whatever is left.
- `glossary.replacements` are applied before publishing. Noise is filtered: empty, punctuation only, repeated 3 times. `[applause]` and similar go out as `kind: 'sound'`.

**Verify:** vitest tests with interim sequences (with pause, without pause, with punctuation).

### [ ] F04.2 · No duplicates
As an attendee, I don't want to read the same phrase twice when the final arrives after an early commit.

- `align.stripCommitted(committed, final)`: normalizes (lowercase, no punctuation or accents) and finds the cut with a word edit distance up to 20%. Returns only the new part.
- The original text is published, not the normalized one.

**Verify:** tests with finals that change punctuation, casing and one word.

### [ ] F04.3 · Translation with vocabulary
As an attendee who doesn't speak the talk's language, I want each phrase translated with the technical terms right.

- One `TRANSLATE_MODEL` call per commit, JSON output for all `targetLangs`, `thinkingBudget: 0`. The prompt is in `docs/architecture.md`.
- Context: title, speaker, last 3 segments, `doNotTranslate` and `preferred`.
- If `src` equals a target language, that language copies the original without calling the model.
- `segment` (original) is published first, then `tr`. Concurrency 2 per stage.
- `ms.mt` is stored per segment.

**Verify:** with a key, `samples/en.mp3` produces `tr` in es and pt, with p50 under 1.5 s from commit (measured in the log).

### [ ] F04.4 · When translation fails
As an attendee, I'd rather see the original than nothing.

- 429/5xx: backoff 1-2-4 s, 3 attempts, then `TRANSLATE_FALLBACK_MODEL`. If that fails, `tr` is `null` for that language.
- The UI shows the original, marked, when the translation is `null` (handled in F07).
- Counts errors per minute for metrics (F09).

**Verify:** with an invalid translation key, `segment` and `tr: { en: null }` arrive and the process doesn't crash.
