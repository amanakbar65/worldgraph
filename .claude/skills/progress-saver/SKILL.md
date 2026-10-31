---
name: progress-saver
description: Keeps long or multi-agent builds safe from usage limits, restarts and crashes, and spends tokens wisely without lowering quality. A silent background saver pushes every agent worktree to GitHub wip branches every 2 minutes, CHECKPOINT.md says how to resume, a loss report tells the owner what share of the interrupted work (lines, commits) was saved or lost, and the token rules keep sessions, agents and resumes lean. Use at the start of any coding project or build that runs agents or workflows or spans sessions, and when the user says approaching limit, mentions usage limits, token use, saving progress or resuming.
---

# Progress saver and token efficiency

Scripts are in this folder; `S` below means wherever you copied them in the project (e.g. `tools/`). Do not read the scripts; just run them. They print a few lines at most.

## Setup (once per project)
1. Copy `checkpoint.sh`, `status.sh` and `loss-report.py` into the repo; commit.
2. Create a short `CHECKPOINT.md` (template below). Point the project's CLAUDE.md to it.
3. From inside the repo: `setsid nohup S/checkpoint.sh 120 12 >/dev/null 2>&1 </dev/null &`. It saves silently every 2 min for 12 h (a snapshot costs no tokens and pushes only when something changed; usage can burn fast, so short intervals lose least). Starting it twice is safe. To stop it, find its PID with `pgrep -af "^bash .*checkpoint.sh"` and kill that PID (`pkill -f` matches and kills your own shell).

## While building
- Launch agents and workflows from inside the repo, after pushing main (agent worktrees branch from origin/main).
- Add this one line to every agent prompt: `After each commit run: git push -qf origin HEAD:refs/heads/wip/$(basename $(git rev-parse --show-toplevel)). Keep running notes in findings.md.`
- Workflow scripts accept `args.done` (labels already merged) and `args.resume` (label to wip branch). A resumed agent first runs `git fetch origin BRANCH && git merge --no-edit FETCH_HEAD`.
- At milestones, edit only the changed lines of CHECKPOINT.md, then commit and push.

## Token efficiency (quality first)
Save tokens only where it costs the work nothing. Never skip lint, type checks, tests, builds or screenshot reviews, and never cut the effort, accuracy or care a task needs to save tokens.
- **Session start:** read CHECKPOINT.md, run `S/status.sh` and the loss report. Read plans, logs and code only when the next step needs them.
- **Interrupted agents restart fresh:** a new agent with a short brief (the task, the files it owns, the checks to run, and "first merge `wip/NAME`") instead of resuming its transcript. Resuming re-reads the whole history, and after a limit pause the cache has expired, so all of it is paid for again.
- **Small agent jobs:** one area each with clear file ownership, so merges stay clean and an interruption loses little. Each brief says: read CLAUDE.md and only the plan section it needs; finish with a report of at most 15 lines.
- **Don't poll agents** or read their transcripts; wait for the completion notice.
- **Read narrowly:** search first (grep, `sed -n` ranges), read only the part of a file you need, and don't re-read a file you just edited. Batch independent tool calls. Keep command output short (`tail`, `grep`, quiet flags).
- **Long conversations:** suggest a fresh chat per phase or milestone; CHECKPOINT.md is the handoff, so no context is lost.
- **Republishing builds with hashed file names** (e.g. a claude.ai Artifact): keep a record of the paths the last publish left and remove the leftovers in the same publish, instead of listing what's live each time.
- **Be honest about cost:** tokens already spent can't be refunded; what can be recovered is the work. Say what will be redone and roughly what it costs.

## "Approaching limit"
Do these in one go, with no other reads:
1. `S/checkpoint.sh --now`. This saves all worktrees and pushes main if it is ahead.
2. Update CHECKPOINT.md's "Updated", "In flight" and "Next". Commit, then run `--now` again or push.
3. Reply to the owner in 2 lines.

## Resuming (new session, or after a limit or restart)
1. `S/status.sh`, and read CHECKPOINT.md (only that file).
2. If the saver is stopped, start it (setup step 3).
3. `python3 S/loss-report.py RUN_DIR...` (or `--latest`), one call for every interrupted run. Run dirs are in `~/.claude/projects/*/*/subagents/workflows/`; for Agent-tool agents, make a folder of links to their `agent-<id>.jsonl` and `.meta.json` in `~/.claude/projects/*/*/subagents/`. It measures **work, not tokens**: lines the agent wrote that are saved on GitHub, its commits, files with lost edits, and commands (tests, checks) run after the last save that must be redone. Send the owner its table: work saved % and lost %, per agent and in total, then say in plain words what was lost and what will be redone. Don't report token figures; the owner cares about the work. For "the previous session", include only the agents that ran in it. Add one line to CHECKPOINT's loss log. If the transcripts are gone (new container), say so and report from status.sh instead (what is saved on which wip branch).
4. Relaunch interrupted agents fresh (see Token efficiency). Only look in transcripts for the unsaved files the report names.

## CHECKPOINT.md template (keep it under 60 lines; history belongs elsewhere)
```markdown
# Checkpoint
Updated: DATE UTC
Resume: cd REPO; S/status.sh; start saver if stopped; loss report; relaunch below.
## In flight
label: wip/BRANCH, state, one-line brief to relaunch it fresh
## Next
1. ...
## Waiting on owner
## Loss log
| when | run | work saved | work lost | what was lost and redone |
```
