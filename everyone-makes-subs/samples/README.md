# Samples

Replayed by `FAKE_BACKEND=1` (see the format comment at the top of `server/src/asr/FakeBackend.ts`).

| File | Talk | Used by |
|---|---|---|
| `es.transcript.json` | "Una guía de navegación: rendimiento en Kubernetes" (es, 90 s) | Stage "Auditorium" |
| `en.transcript.json` | "Model Context Protocol in Plain English" (en, 100 s) | Stage "Room 2" |
| `mixed.transcript.json` | 30 s of each, no declared language (detected per sentence) | — |

**Audio (F01.3):** 16 kHz mono cuts from public Nerdearla talks on YouTube, used by `DEMO=1` with a key:

| File | Source |
|---|---|
| `es.mp3` (90 s) | "Una guía de navegación: rendimiento en Kubernetes" — Almudena Vivanco, https://www.youtube.com/watch?v=KEZ7AKqYIHg (03:00–04:30) |
| `en.mp3` (100 s) | "Model Context Protocol in Plain English" — Nate Barbettini, https://www.youtube.com/watch?v=iaG9pHMJ3Y4 (03:00–04:40) |
| `mixed.mp3` (60 s) | 30 s of `es.mp3` followed by 30 s of `en.mp3` (a bilingual panel: the language is detected per sentence) |

**The `.transcript.json` files are real output of the pipeline** (Gemini Live → segmenter → translator) over these files, recorded with `npm run samples` (see `server/scripts/transcribe-file.ts`). The replay starts at ~1 s and caps translation waits at 2.5 s (free-tier quota waits are not representative). Without a key, `FAKE_BACKEND=1` and `DEMO=1` replay them.
