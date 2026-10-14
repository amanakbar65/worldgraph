#!/usr/bin/env bash
# One-screen summary of the build's live state, for resuming after a pause:
# main vs GitHub, each agent worktree (label, commits, uncommitted files, last
# save), the progress saver, and running workflows' last results.
set -u
cd "$(git rev-parse --show-toplevel)" || exit 1
git fetch -q origin 2>/dev/null
echo "main: $(git log --oneline -1 main) | ahead of GitHub: $(git rev-list --count origin/main..main)"
for w in .claude/worktrees/*; do
  [ -e "$w/.git" ] || continue
  name="$(basename "$w")"
  label="$(git -C "$w" log --format=%s main..HEAD 2>/dev/null | grep -v -e '^Merge' -e '^WIP' | tail -1 | cut -d: -f1)"
  saved="$(git log -1 --format=%cr "origin/wip/$name" 2>/dev/null || echo never)"
  echo "$name [${label:-not started}]: $(git -C "$w" rev-list --count main..HEAD) commits, $(git -C "$w" status --short | wc -l) uncommitted, saved $saved"
done
if pgrep -f "checkpoint.sh" >/dev/null; then echo "saver: running"; else echo "saver: STOPPED (start: setsid nohup orchestration/checkpoint.sh 600 12 >/dev/null 2>&1 </dev/null &)"; fi
tail -1 orchestration/.checkpoint.log 2>/dev/null
