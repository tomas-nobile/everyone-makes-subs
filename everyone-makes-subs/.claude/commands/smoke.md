---
description: Quick end-to-end check that the system works
---

1. `npm run check`
2. `npm run smoke` (server with `FAKE_BACKEND=1`, SSE connection, waits for `segment` and `tr` within 15 s).
3. With the server running: `curl -s localhost:8080/api/health` and `curl -s localhost:8080/api/event`.
4. If `.env` has a key: start a stage with `samples/es.mp3` for 30 s and check that real translations arrive.

Reply with a table: step · ok/fail · detail. If something fails, propose the exact `/fix`.
