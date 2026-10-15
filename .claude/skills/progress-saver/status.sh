#!/usr/bin/env bash
# One-screen summary for resuming after a pause: the main branch vs GitHub,
# every agent worktree (label, commits, uncommitted files, last save) and
# whether the progress saver is running.
set -u
ROOT="$(git rev-parse --show-toplevel)" || exit 1
cd "$ROOT" || exit 1
GITDIR="$(git rev-parse --git-common-dir)"
git fetch -q origin 2>/dev/null
BASE="$(git symbolic-ref -q --short refs/remotes/origin/HEAD 2>/dev/null || echo origin/main)"
echo "$(git branch --show-current): $(git log --oneline -1) | ahead of $BASE: $(git rev-list --count "$BASE..HEAD" 2>/dev/null)"
git worktree list --porcelain | sed -n 's/^worktree //p' | while read -r w; do
  [ "$w" = "$ROOT" ] && continue
  name="$(basename "$w")"
  label="$(git -C "$w" log --format=%s "$BASE..HEAD" 2>/dev/null | grep -v -e '^Merge' -e '^WIP' | tail -1 | cut -d: -f1)"
  saved="$(git log -1 --format=%cr "origin/wip/$name" 2>/dev/null || echo never)"
  echo "$name [${label:-no commits yet}]: $(git -C "$w" rev-list --count "$BASE..HEAD" 2>/dev/null) commits, $(git -C "$w" status --short | wc -l) uncommitted, saved $saved"
done
if ! flock -n "$GITDIR/progress-saver.lock" true 2>/dev/null; then echo "saver: running"; else echo "saver: STOPPED"; fi
tail -1 "$GITDIR/progress-saver.log" 2>/dev/null
