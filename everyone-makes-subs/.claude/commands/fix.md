---
description: Fix a bug fast and commit
argument-hint: bug description
---

Bug: $ARGUMENTS

1. Reproduce it with the minimum: a command, a `curl` or a test.
2. Find the cause. Don't patch the symptom if the cause is in plain sight.
3. Fix it. If it's pure logic, keep the test that reproduces it.
4. `npm run check` and commit: `fix: <what>`.
5. Reply in 2 lines: cause and fix.

Timebox: 20 minutes. If it doesn't work out, log it as `TODO:` in `docs/decisions.md` with what you know and say so.
