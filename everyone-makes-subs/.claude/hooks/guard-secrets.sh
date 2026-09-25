#!/bin/bash
# The project's only hook. Runs in milliseconds and only acts on `git commit`.
# Blocks commits that include .env, data/ or a Google API key.
INPUT=$(cat)
case "$INPUT" in
  *"git commit"*) ;;
  *) exit 0 ;;
esac

FILES=$(git diff --cached --name-only 2>/dev/null)
DIFF=$(git diff --cached -U0 2>/dev/null)
# `git commit -a` / `-am` stages tracked changes at commit time
case "$INPUT" in
  *"commit -a"*|*"commit -am"*|*"commit --all"*)
    FILES="$FILES
$(git diff --name-only 2>/dev/null)"
    DIFF="$DIFF
$(git diff -U0 2>/dev/null)" ;;
esac

if echo "$FILES" | grep -qE '(^|/)\.env$|^data/'; then
  echo "Commit blocked: it includes .env or data/. Unstage it with 'git restore --staged <file>'." >&2
  exit 2
fi
if echo "$DIFF" | grep -E '^\+' | grep -qE 'AIza[0-9A-Za-z_-]{30,}'; then
  echo "Commit blocked: the diff contains a Google API key. Move it to .env." >&2
  exit 2
fi
exit 0
