# F11 · First-run setup

**Priority:** P1 (US1–3) · P2 (US4) · **Lane:** frontend + backend (`/api/setup`, `public/`) · **Depends on:** F01 · **Prototype:** "First-run setup" tab · **Architecture:** "First-run setup", "Wizard step 3", "Public access"

**Goal:** someone who isn't a developer gets everything running without a terminal or a `.env`.

## Stories

### [x] F11.1 · Connect Gemini
As an operator, I want to paste my API key and know right away if it works.

- `/setup` shows while there's no valid key. If `GEMINI_API_KEY` comes from env, this step is skipped.
- 3-step instructions with a link to AI Studio.
- "Test": `POST /api/setup/key` runs a short translation. Plain-language errors: invalid key, project without access to the model, no quota.
- Stored in `data/config.json` (mode 0600). Notice about data usage on the free tier.

**Verify:** an invalid key shows the error; a valid one enables "Next".

### [x] F11.2 · Dashboard password
As an operator, I want to protect the dashboard.

- Set and stored as a hash (scrypt). It's the one F09.1 uses.
- `/api/setup/*` only answers without auth from `127.0.0.1` or while no password exists.

**Verify:** after setup, `/admin` from another machine asks for the password.

### [x] F11.3 · Internet access with Tailscale
As an operator, I want phones to get in from any network, with a secure, fixed address.

- 4-item checklist (each unlocks when the previous one is ✓), as in the prototype:
  1. **Install:** detects the binary (PATH; on Mac `/Applications/Tailscale.app/Contents/MacOS/Tailscale`; on Windows `C:\Program Files\Tailscale\tailscale.exe`). If missing: "Download" and "I installed it".
  2. **Sign in:** `tailscale status --json` → `BackendState === "Running"`. Otherwise `tailscale up`, polling every 2 s.
  3. **Enable:** `tailscale funnel --bg 8080`. If the CLI returns a consent link, open it and show "Click Enable and come back".
  4. **Test from outside:** URL from `Self.DNSName`; `GET <url>/api/health?nonce=` must echo the nonce.
- `publicUrl` is saved. Every QR and link uses it.
- Dashboard: "Reachable" badge with a check every 60 s and an alert if it fails.

**Verify:** on the demo machine, a phone on mobile data opens `/s/auditorium`.

### [x] F11.4 · Cloudflare and other options
As the operator of a large event, I want to use my own domain.

- Cloudflare: dashboard instructions, paste token and hostname → `cloudflared tunnel run --token` (binary downloaded on first use) + the same nonce test.
- "Other options" (collapsed): "This Wi-Fi only (for testing)" and "I already have a server with a public address" (`PUBLIC_URL`).
- In Docker: show the Tailscale command to run on the host and only run the test.

**Verify:** the own-URL option saves the address and the nonce test passes.
