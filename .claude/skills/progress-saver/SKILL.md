---
name: progress-saver
description: Keeps long or multi-agent builds safe from usage limits, restarts and crashes at minimal token cost. A silent background saver pushes every agent worktree to GitHub wip branches every 10 minutes, CHECKPOINT.md says how to resume, and a loss report tells the owner what percentage of interrupted work was retained or lost. Use at the start of any build that runs agents or workflows or spans sessions, and when the user says approaching limit, mentions usage limits, saving progress or resuming.
---

# Progress saver

Scripts are in this folder; `S` below means wherever you copied them in the project (e.g. `tools/`). Do not read the scripts; just run them. They print a few lines at most.

## Setup (once per project)
1. Copy `checkpoint.sh`, `status.sh` and `loss-report.py` into the repo; commit.
2. Create a short `CHECKPOINT.md` (template below). Point the project's CLAUDE.md to it.
3. From inside the repo: `setsid nohup S/checkpoint.sh 600 12 >/dev/null 2>&1 </dev/null &`. It saves silently every 10 min for 12 h. Starting it twice is safe.

## While building
- Launch workflows from inside the repo, after pushing main.
- Add this one line to every agent prompt: `After each commit run: git push -qf origin HEAD:refs/heads/wip/$(basename $(git rev-parse --show-toplevel)). Keep running notes in findings.md.`
- Workflow scripts accept `args.done` (labels already merged) and `args.resume` (label to wip branch). A resumed agent first runs `git fetch origin BRANCH && git merge --no-edit FETCH_HEAD`.
- At milestones, edit only the changed lines of CHECKPOINT.md, then commit and push.

## "Approaching limit"
Do these in one go, with no other reads:
1. `S/checkpoint.sh --now`. This saves all worktrees and pushes main if it is ahead.
2. Update CHECKPOINT.md's "Updated", "In flight" and "Next". Commit, then run `--now` again or push.
3. Reply to the owner in 2 lines.

## Resuming (new session, or after a limit or restart)
1. `S/status.sh`, and read CHECKPOINT.md (only that file).
2. If the saver is stopped, start it (setup step 3).
3. `python3 S/loss-report.py RUN_DIR...` (or `--latest`), one call for every interrupted run. Run dirs are in `~/.claude/projects/*/*/subagents/workflows/`. Send the owner its table as-is: retained % and lost %, per agent and in total. Add one line to CHECKPOINT's loss log. If the transcripts are gone (new container), say so and report from status.sh instead (what is saved on which wip branch).
4. Relaunch with `args.resume`. Only look in transcripts for the unsaved files the report names.

## CHECKPOINT.md template (keep it under 60 lines; history belongs elsewhere)
```markdown
# Checkpoint
Updated: DATE UTC
Resume: cd REPO; S/status.sh; start saver if stopped; loss report; relaunch below.
## In flight
RUN_ID script args. label: wip/BRANCH, state
## Next
1. ...
## Waiting on owner
## Loss log
| when | run | tokens | retained | lost |
```
