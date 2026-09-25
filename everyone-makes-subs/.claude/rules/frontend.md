---
paths:
  - "web/**"
---

# Frontend

- **The visual reference is `docs/ui-prototype.html`.** Copy its color tokens (`:root`), typography and the structure of each view. Don't invent new styles.
- React + plain CSS (one `styles.css` with the prototype's tokens). No component or state libraries: `useState` + a `useStageStream(stageId)` hook that owns the SSE.
- Minimal router: `/`, `/s/:id`, `/s/:id/tv`, `/s/:id/overlay`, `/station/:id`, `/admin`, `/setup`.
- Operator UI copy in plain language ("No audio", "Delayed"). Technical numbers only inside "Technical details".
- Attendee views (phone, TV, overlay): strings in a small `i18n.ts` dictionary (en/es/pt); the language comes from `?lang=` or `navigator.language`.
- Attendee view: `aria-live="polite"` only on confirmed lines, never on the live line. Respect `prefers-reduced-motion`.
- Build against `npm run dev:fake`. If you need data the backend doesn't send yet, mock it in the hook and log `CONTRACT:` in `docs/decisions.md`.
- Verification: open the view once at 390 px and at desktop width. No UI tests.
