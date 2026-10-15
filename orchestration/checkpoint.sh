#!/usr/bin/env bash
# Kept for old instructions: the progress saver now lives in the reusable skill.
exec "$(git rev-parse --show-toplevel)/.claude/skills/progress-saver/checkpoint.sh" "$@"
