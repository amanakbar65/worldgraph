#!/usr/bin/env bash
# Saves every running agent's work-in-progress to GitHub so a usage limit,
# a container restart or a crash never loses it.
#
# Every INTERVAL seconds, for each agent worktree under .claude/worktrees/:
# snapshot all changes (committed and uncommitted) into a commit built with a
# temporary index, so the agent's own branch and index are untouched, and
# force-push it to wip/<worktree-name>. Also pushes main if it is ahead.
#
# Run in the background from the repo root:  orchestration/checkpoint.sh 600
set -u
INTERVAL="${1:-600}"
ROOT="$(git rev-parse --show-toplevel)"
LOG="$ROOT/orchestration/.checkpoint.log"

snapshot() {
  local w="$1" name idx tree parent commit
  name="$(basename "$w")"
  idx="$(mktemp)"
  cp "$(git -C "$w" rev-parse --git-dir)/index" "$idx" 2>/dev/null || true
  GIT_INDEX_FILE="$idx" git -C "$w" add -A -- . ':!frontend/node_modules' ':!frontend/test-results' \
    ':!backend/data/cache' >/dev/null 2>&1
  tree="$(GIT_INDEX_FILE="$idx" git -C "$w" write-tree)"
  rm -f "$idx"
  parent="$(git -C "$w" rev-parse HEAD)"
  # Skip when nothing changed since the last snapshot.
  local last
  last="$(git -C "$w" rev-parse -q --verify "refs/remotes/origin/wip/$name^{tree}" 2>/dev/null || true)"
  [ "$tree" = "$last" ] && return 0
  commit="$(printf 'WIP snapshot of %s (agent still working)\n\nFiles changed vs main:\n%s\n' "$name" \
    "$(git -C "$w" diff --stat "$(git -C "$w" merge-base HEAD origin/main)" "$tree" | tail -15)" \
    | git -C "$w" commit-tree "$tree" -p "$parent")"
  if git -C "$w" push -q -f origin "$commit:refs/heads/wip/$name" 2>>"$LOG"; then
    git -C "$w" update-ref "refs/remotes/origin/wip/$name" "$commit"
    echo "$(date -u +%FT%TZ) saved $name -> $commit" >>"$LOG"
  fi
}

while true; do
  for w in "$ROOT"/.claude/worktrees/*; do
    [ -d "$w" ] && [ -e "$w/.git" ] && snapshot "$w"
  done
  if [ -n "$(git -C "$ROOT" log origin/main..main --oneline 2>/dev/null)" ]; then
    git -C "$ROOT" push -q origin main 2>>"$LOG" && echo "$(date -u +%FT%TZ) pushed main" >>"$LOG"
  fi
  sleep "$INTERVAL"
done
