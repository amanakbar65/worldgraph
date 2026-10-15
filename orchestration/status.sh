#!/usr/bin/env bash
# Kept for old instructions: the status script now lives in the reusable skill.
exec "$(git rev-parse --show-toplevel)/.claude/skills/progress-saver/status.sh" "$@"
