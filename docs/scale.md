# Scale: what one machine holds (F19.2)

Numbers the Scalability chapter of the video (F16.6) and the README's "How to scale" section quote. Every row comes from `npm run load -- --stages=N --clients=M` on the machine named in the row; the script writes the same figures to `bench/scale-<timestamp>.json`, which the video reads.

## What the test does

`npm run load` boots the server in fake mode with N rooms (`DEMO_STAGES=N`, the recorded pipeline output replaying, so no key and no network), opens M SSE viewers spread round-robin over the rooms from the same machine, and for 30 s records when each viewer receives each phrase. It reports, per room, how many phrases reached every viewer and the **fan-out spread** (first viewer → last viewer, i.e. how long the server needs to deliver one phrase to everyone), and samples the server process's CPU (% of one core) and RSS every 2 s through `GET /api/dev/stats`.

The AI side is not part of this test on purpose: it is one Live session plus one translation call per phrase **per room**, independent of the audience (see `pricing.md`). What scales with the audience is only this fan-out.

## Results

| Rooms | Viewers (total) | Spread p50 | Spread p95 (max) | Server CPU (avg, max) | RSS idle → loaded | Machine |
|---|---|---|---|---|---|---|
| **8** | **2,000** (250 per room) | **7 ms** | **11 ms** (15 ms) | 44 % (61 %) of one core | 103 → 157 MB | AMD Ryzen 5 3600 (12 threads), 16 GB, Windows 11, Node 25 · `bench/scale-2026-09-25T04-20-25.json` |

Every room delivered every phrase to all 250 of its viewers (one room missed one phrase that was in flight when the 30 s window closed); 0 connection failures.

Earlier, single-room run (v1.0.0 README): 1 room × 2,000 viewers, every phrase to every viewer within ~65 ms, +67 MB of RAM (92 → 159 MB).

## Reading the numbers

- The spread is the cost of the audience: with 2,000 viewers on one laptop, everyone has the phrase within tens of milliseconds of each other. Attendees on phones add the tunnel's own hop on top (Tailscale Funnel or a named Cloudflare tunnel).
- CPU is the fan-out plus N replaying rooms; a real room adds an ffmpeg decode and the Live session's WebSocket, both light. The work is I/O-bound.
- Past this: `web` replicas behind a proxy or CDN with Redis pub/sub in place of the in-process EventBus (same publish/subscribe interface), same Docker image. The AI cost does not change.
