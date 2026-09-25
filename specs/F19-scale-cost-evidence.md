# F19 · Scale and cost evidence

**Priority:** P1 · **Lane:** backend / `scripts/` · **Depends on:** F05, `npm run load`

The Scalability and Price chapters of the video (F16.6, F16.8) only show numbers that come from here.

## Stories

### [x] F19.1 · N rooms in the demo
As the team, we want the dashboard to look like a whole conference.

- `DEMO_STAGES=N` (default 2) creates N rooms ("Auditorium", "Room 2" … "Room N"), cycling the samples (`en`, `es`, `mixed`), each with a current and a next talk. Replay without a key, real pipeline with one. "Try with sample data" keeps 2.

**Verify:** `DEMO_STAGES=8 npm run dev:fake` → the dashboard shows 8 rooms live.

### [ ] F19.2 · Load numbers for N rooms
As a judge, I want to know what one machine holds.

- `npm run load -- --stages=N --clients=M`: N rooms × M viewers in total (e.g. 8 × 250 = 2,000); reports server CPU % and RAM, and the delivery spread p95 per room.
- Results in `docs/scale.md` (one table, with the machine) and the README scaling section.

**Verify:** the `docs/scale.md` table comes from a real run on the demo machine.

### [ ] F19.3 · Measured cost and market comparison
As a judge, I want the price claim to be real and comparable.

- Run K rooms live with a real key for 10 minutes (samples looping) and count audio minutes sent plus translation tokens (from `usageMetadata`; add the counter if it is not tracked) → US$ per room-hour for Spanish only and Spanish + Portuguese.
- `docs/pricing.md`: that measured figure vs list prices per language (Gemini Live Translate, OpenAI gpt-realtime-translate) and, only with a public cited price, commercial captioning or human interpretation; the "Nerdearla day" row (10 rooms × 9 h); the "audience adds zero cost" line; source URLs and date. Starting data: `docs/market/analysis.md` §2.

**Verify:** every price has a source; the measured row matches the run's output.
