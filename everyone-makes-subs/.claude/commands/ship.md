---
description: Hackathon submission checklist
---

Check and fix whatever is missing, in this order. Tick each item in your reply.

1. `git log -p | grep -E "AIza[0-9A-Za-z_-]{30,}"` returns nothing. If it returns something: say so **immediately** (the key must be rotated and the history cleaned).
2. `LICENSE` (MIT) exists.
3. `README.md` has: what it is + GIF or screenshot, install (installer and `docker compose up`), first-run setup, audio sources, how to scale, costs, limitations, free-tier data usage and the video link.
4. `DEMO=1` starts 2 stages with `samples/`.
5. `docker compose up --build` starts from scratch (if Docker is available).
6. `.env.example` has no real values.
7. Push to `main`.
