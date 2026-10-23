#!/usr/bin/env bash
# Progress saver. Every INTERVAL seconds, for MAX_HOURS, pushes each agent worktree
# (commits and uncommitted work) to origin wip/NAME. Silent; log and lock in .git.
#   setsid nohup checkpoint.sh 120 12 >/dev/null 2>&1 </dev/null &   # background
#   checkpoint.sh --now   # save every worktree once and push main if it is ahead
set -u
ONCE=0; [ "${1:-}" = "--now" ] && { ONCE=1; shift; }
INTERVAL="${1:-120}"; MAX_HOURS="${2:-12}"
ROOT="$(git rev-parse --show-toplevel)" || exit 1
GITDIR="$(git -C "$ROOT" rev-parse --git-common-dir)"
case "$GITDIR" in /*) ;; *) GITDIR="$ROOT/$GITDIR" ;; esac
LOG="$GITDIR/progress-saver.log"
if [ "$ONCE" = 0 ]; then exec 9>"$GITDIR/progress-saver.lock"; flock -n 9 || exit 0; fi
END=$(( $(date +%s) + MAX_HOURS * 3600 ))
[ "$ONCE" = 0 ] && echo "$(date -u +%FT%TZ) started pid $$" >>"$LOG"

snapshot() {
  local w="$1" name idx tree commit
  name="$(basename "$w")"; idx="$(mktemp)"
  cp "$(git -C "$w" rev-parse --git-dir)/index" "$idx" 2>/dev/null
  GIT_INDEX_FILE="$idx" git -C "$w" add -A -- . ':(exclude,glob)**/node_modules/**' \
    ':(exclude,glob)**/.venv/**' ':(exclude,glob)**/__pycache__/**' >/dev/null 2>&1
  # Agents' notes are kept even inside ignored folders.
  GIT_INDEX_FILE="$idx" git -C "$w" add -f -- ':(glob)**/findings.md' ':(glob)**/agent-notes/**' >/dev/null 2>&1
  tree="$(GIT_INDEX_FILE="$idx" git -C "$w" write-tree)"; rm -f "$idx"
  [ "$tree" = "$(git -C "$w" rev-parse -q --verify "refs/remotes/origin/wip/$name^{tree}" 2>/dev/null)" ] && return 0
  commit="$(echo "WIP snapshot of $name" | git -C "$w" commit-tree "$tree" -p "$(git -C "$w" rev-parse HEAD)")"
  if git -C "$w" push -q -f origin "$commit:refs/heads/wip/$name" 2>>"$LOG"; then
    git -C "$w" update-ref "refs/remotes/origin/wip/$name" "$commit"
    echo "$(date -u +%FT%TZ) saved $name" >>"$LOG"
  else echo "push FAILED: $name (see $LOG)" >&2; fi
}

while [ "$(date +%s)" -lt "$END" ]; do
  git -C "$ROOT" worktree list --porcelain | sed -n 's/^worktree //p' | while read -r w; do
    [ "$w" != "$ROOT" ] && [ -d "$w" ] && snapshot "$w"
  done
  if [ "$ONCE" = 1 ] || [ "${PUSH_MAIN:-0}" = 1 ]; then
    [ -n "$(git -C "$ROOT" log '@{u}..HEAD' --oneline 2>/dev/null)" ] && git -C "$ROOT" push -q 2>>"$LOG"
  fi
  [ "$ONCE" = 1 ] && { echo "saved"; exit 0; }
  sleep "$INTERVAL" 9>&-  # the sleep must not hold the lock
done
echo "$(date -u +%FT%TZ) stopped after ${MAX_HOURS}h" >>"$LOG"
