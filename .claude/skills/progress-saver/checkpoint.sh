#!/usr/bin/env bash
# Progress saver: pushes every agent worktree's work (committed and uncommitted)
# to wip/<worktree-name> on origin at a fixed interval, so a usage limit, a
# container restart or a crash never loses work. Works in any git repository.
#
# Start it detached from inside the repo (it outlives tool time limits and keeps
# saving after a usage limit stops the agents):
#   setsid nohup <path>/checkpoint.sh 600 12 >/dev/null 2>&1 </dev/null &
# Arguments: seconds between saves (default 600), hours before it stops (default 12).
# A lock file makes a second copy exit at once, so starting it again is safe.
# Set PUSH_MAIN=1 to also push the main checkout's branch when it is ahead.
set -u
INTERVAL="${1:-600}"
MAX_HOURS="${2:-12}"
ROOT="$(git rev-parse --show-toplevel)" || exit 1
GITDIR="$(git -C "$ROOT" rev-parse --git-common-dir)"
case "$GITDIR" in /*) ;; *) GITDIR="$ROOT/$GITDIR" ;; esac
LOG="$GITDIR/progress-saver.log"

exec 9>"$GITDIR/progress-saver.lock"
if ! flock -n 9; then echo "Progress saver already running." >&2; exit 0; fi
END=$(( $(date +%s) + MAX_HOURS * 3600 ))
echo "$(date -u +%FT%TZ) saver started (every ${INTERVAL}s for ${MAX_HOURS}h, pid $$)" >>"$LOG"

snapshot() {
  local w="$1" name idx tree last commit
  name="$(basename "$w")"
  idx="$(mktemp)"
  cp "$(git -C "$w" rev-parse --git-dir)/index" "$idx" 2>/dev/null || true
  # .gitignore applies; heavy folders are skipped even if a project forgot to ignore them.
  GIT_INDEX_FILE="$idx" git -C "$w" add -A -- . \
    ':(exclude,glob)**/node_modules/**' ':(exclude,glob)**/.venv/**' \
    ':(exclude,glob)**/__pycache__/**' >/dev/null 2>&1
  # Agents' working notes are kept even inside ignored folders (e.g. test-results/).
  GIT_INDEX_FILE="$idx" git -C "$w" add -f -- ':(glob)**/findings.md' ':(glob)**/agent-notes/**' >/dev/null 2>&1 || true
  tree="$(GIT_INDEX_FILE="$idx" git -C "$w" write-tree)"
  rm -f "$idx"
  last="$(git -C "$w" rev-parse -q --verify "refs/remotes/origin/wip/$name^{tree}" 2>/dev/null || true)"
  [ "$tree" = "$last" ] && return 0
  commit="$(printf 'WIP snapshot of %s (agent still working)\n' "$name" \
    | git -C "$w" commit-tree "$tree" -p "$(git -C "$w" rev-parse HEAD)")"
  if git -C "$w" push -q -f origin "$commit:refs/heads/wip/$name" 2>>"$LOG"; then
    git -C "$w" update-ref "refs/remotes/origin/wip/$name" "$commit"
    echo "$(date -u +%FT%TZ) saved $name -> $commit" >>"$LOG"
  fi
}

while [ "$(date +%s)" -lt "$END" ]; do
  # Every worktree except the main checkout.
  git -C "$ROOT" worktree list --porcelain | sed -n 's/^worktree //p' | while read -r w; do
    [ "$w" = "$ROOT" ] && continue
    [ -d "$w" ] && snapshot "$w"
  done
  if [ "${PUSH_MAIN:-0}" = 1 ] && git -C "$ROOT" rev-parse -q --verify '@{u}' >/dev/null 2>&1 \
     && [ -n "$(git -C "$ROOT" log '@{u}..HEAD' --oneline 2>/dev/null)" ]; then
    git -C "$ROOT" push -q 2>>"$LOG" && echo "$(date -u +%FT%TZ) pushed main checkout" >>"$LOG"
  fi
  sleep "$INTERVAL" 9>&-  # the sleep must not hold the lock
done
echo "$(date -u +%FT%TZ) saver stopped after ${MAX_HOURS}h" >>"$LOG"
