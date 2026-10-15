#!/usr/bin/env bash
# One short screen for resuming: main vs origin, each agent worktree, saver state.
set -u
ROOT="$(git rev-parse --show-toplevel)" || exit 1
cd "$ROOT" || exit 1
GITDIR="$(git rev-parse --git-common-dir)"
git fetch -q origin 2>/dev/null
BASE="$(git symbolic-ref -q --short refs/remotes/origin/HEAD 2>/dev/null || echo origin/main)"
echo "$(git branch --show-current) $(git log --format='%h %s' -1 | cut -c1-60) | ahead $(git rev-list --count "$BASE..HEAD")"
git worktree list --porcelain | sed -n 's/^worktree //p' | while read -r w; do
  [ "$w" = "$ROOT" ] && continue
  n="$(basename "$w")"
  echo "$n: $(git -C "$w" rev-list --count "$BASE..HEAD" 2>/dev/null) commits, $(git -C "$w" status --short | wc -l) dirty, saved $(git log -1 --format=%cr "origin/wip/$n" 2>/dev/null || echo never)"
done
flock -n "$GITDIR/progress-saver.lock" true 2>/dev/null && echo "saver: STOPPED" || echo "saver: running"
