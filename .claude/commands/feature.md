---
description: Implement a whole feature (all its stories) in fast mode
argument-hint: F04 | F04.2
---

Implement `$ARGUMENTS` following `CLAUDE.md`. No questions, no pauses: end to end.

1. **Resolve the scope.**
   - `F04` → every pending (`[ ]`) story in `specs/F04-*.md`, in order.
   - `F04.2` → only that story.
   - Read that file and **only** the sections of `docs/architecture.md` it cites. If the story has UI, open the matching view in `docs/ui-prototype.html`.
2. **For each story:**
   1. Implement the minimum that meets the acceptance criteria. Nothing more.
   2. If it's pure logic, write its vitest test in the same step.
   3. Run `npm run check` (and `npm test -- <file>` if you added a test). Fix until it passes.
   4. Do the check listed under "Verify" (once).
   5. Mark the story `[x]` in the feature file and in `docs/README.md`.
   6. Commit: `git add <your folders> docs && git commit -m "F04.2: <what>"`.
   7. If 20 minutes pass and it still doesn't work: working stub + `TODO:` in `docs/decisions.md` + commit + next story.
3. **When the feature is done:** run `npm run smoke` if the server is involved. Reply in 3–5 lines: what's done, what's left as TODO, and the next story according to `docs/README.md`.

Don't: branches, PRs, issues, long ADRs, refactors outside the story, UI tests or subagent reviews.
