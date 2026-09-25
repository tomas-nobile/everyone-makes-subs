# Samples

Replayed by `FAKE_BACKEND=1` (see the format comment at the top of `server/src/asr/FakeBackend.ts`).

| File | Talk | Used by |
|---|---|---|
| `es.transcript.json` | "Observabilidad sin dolor" (es, ~65 s) | Stage "Auditorium" |
| `en.transcript.json` | "Shipping LLM features on a budget" (en, ~55 s) | Stage "Room 2" |
| `mixed.transcript.json` | Panel es/en/pt (~32 s) | — |

**Audio (F01.3):** 16 kHz mono cuts from public Nerdearla talks on YouTube, used by `DEMO=1` with a key:

| File | Source |
|---|---|
| `es.mp3` (90 s) | "Una guía de navegación: rendimiento en Kubernetes" — Almudena Vivanco, https://www.youtube.com/watch?v=KEZ7AKqYIHg (03:00–04:30) |
| `en.mp3` (100 s) | "Model Context Protocol in Plain English" — Nate Barbettini, https://www.youtube.com/watch?v=iaG9pHMJ3Y4 (03:00–04:40) |

**The `.transcript.json` files are still placeholders** (hand-written text, synthetic timing) until they are regenerated from the audio with a key; without a key, the samples replay them.
