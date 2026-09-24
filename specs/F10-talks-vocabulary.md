# F10 · Talks, schedule and vocabulary

**Priority:** P1 (US1, US4) · P2 (US2, US3) · **Lane:** backend (logic) + frontend (forms) · **Depends on:** F05, F06.1 · **Architecture:** "6. Glossary, schedule and summary"

**Goal:** technical terms come out right without manual work, and the day runs itself according to the schedule.

## Stories

### [ ] F10.1 · Automatic vocabulary per talk
As an operator, I want to load a talk's title and abstract and have the system build its vocabulary.

- `POST /api/stages/:id/talk` with `{ title, speaker, abstract, lang?, slidesText? }` → one `AUX_MODEL` call with JSON `Glossary` output (up to 100 ASR terms, `doNotTranslate`, `preferred`, `replacements`).
- The talk becomes current. The translator uses it from the next segment on, and `requestRotation()` (F06.1) makes the ASR pick it up at the next pause.
- `PUT /api/talks/:id/glossary` to edit (chips + "Add term" in the side panel).
- A fake version returns a fixed glossary.

**Verify:** with the prototype's OpenTelemetry talk, the glossary includes OpenTelemetry, OTLP and DaemonSet.

### [ ] F10.2 · Paste the schedule
As an operator, I want to paste the schedule as it appears on the website and get stages and talks.

- `POST /api/agenda/parse` with free text → `{ rooms, talks[] }` (via `AUX_MODEL`). An editable table is shown for confirmation.
- `POST /api/agenda` saves: creates missing stages and generates glossaries in batch (concurrency 4) with progress.

**Verify:** paste the sample text from the prototype (setup step 4) and get 2 stages and 4 talks.

### [ ] F10.3 · Talk switch by schedule
As an operator, I don't want to watch the clock for 10 stages.

- At the next talk's `startsAt`: alert "Room X · 15:30 · Move to the next talk?" with "Switch now" and "Wait 5 min".
- With no answer, it switches on its own at +5 min, at the next silence longer than 3 s.
- `POST /api/stages/:id/next-talk` is always available. Switching closes the previous talk's JSONL.

**Verify:** set a talk starting in 1 minute and see the alert and the switch.

### [ ] F10.4 · Vocabulary visibly working
As an operator (and as a judge), I want to see the vocabulary being used.

- Count occurrences of each `asrVocabulary` term in the current talk's segments (case- and accent-insensitive).
- In the side panel: "Kubernetes ✓ 9". Terms with no hits stay gray.

**Verify:** with the Spanish sample, the counters go up.
