---
name: progress-saver
description: Keep long or multi-agent builds safe from usage limits, container restarts and crashes. A detached saver pushes every agent worktree to wip/<worktree> branches every 10 minutes, CHECKPOINT.md records how to resume, a status script shows the whole state in one screen, and a loss report tells the owner what percentage of interrupted work was retained vs lost. Use at the start of any build that runs agents or workflows, spans sessions, or when the user mentions usage limits, saving progress or resuming.
---

# Progress saver

Long builds get cut off: session and weekly usage limits stop agents mid-task, containers restart, and background commands are killed after a time limit. This skill keeps every agent's work on GitHub and makes resuming quick and cheap.

## Set up (once per project, at the start of the build)

1. Copy `checkpoint.sh`, `status.sh` and `loss-report.py` from this skill's folder into the project, e.g. `orchestration/` or `tools/`, and commit them. They work in any git repository: logs and lock live inside `.git`.
2. Create `CHECKPOINT.md` at the repository root from the template below, and point to it from the project's `CLAUDE.md` ("Start here after any pause").
3. `cd` into the repository, then start the saver detached:
   `setsid nohup <path>/checkpoint.sh 600 12 >/dev/null 2>&1 </dev/null &`
   It saves every 10 minutes for 12 hours and keeps running after a usage limit stops the agents. Starting it again is harmless (a lock makes a second copy exit). Restart it after any container restart; `status.sh` says whether it is running.

## Rules while the build runs

- **Start workflows from inside the repository.** After a restart the shell often starts in the home folder, and worktree agents then fail instantly with "not in a git repository".
- **Push `main` before launching agents**: worktrees branch from `origin/main`.
- **Agents push their own work.** Put this in every agent prompt: "Commit after each working milestone, and after every commit run `git push -q -f origin HEAD:refs/heads/wip/$(basename "$(git rev-parse --show-toplevel)")`. Usage limits can stop you without warning."
- **Agents keep running notes in `findings.md` (or an `agent-notes/` folder)**, especially agents that only report at the end, such as reviewers. The saver keeps these even inside git-ignored folders, so a stopped reviewer's findings survive. If one is lost anyway, its transcript in `~/.claude/projects/<session>/subagents/` still holds what it wrote.
- **Make workflow scripts resumable**: accept `args.done` (labels already merged) and `args.resume` (label → `wip/...` branch), and tell a resumed agent to `git fetch origin <branch> && git merge --no-edit FETCH_HEAD` first.
- **Update CHECKPOINT.md at every milestone** (merge, launch, relaunch): run IDs, worktree → `wip/` branch, the exact relaunch args, and anything waiting on the owner. Commit and push it.

## When the user says "approaching limit"

1. Force-save every worktree now (do not wait for the 10-minute round): `<path>/checkpoint.sh --now`.
2. If an agent has finished, record it (and merge it if there is time to run the checks).
3. Update CHECKPOINT.md ("Last updated", what's running, the relaunch command) and push `main`.
4. Tell the user in a few lines what is saved and what happens next session.

## When resuming

1. `cd` into the repository, run `status.sh`, and read CHECKPOINT.md.
2. Restart the saver if it says STOPPED.
3. **Report retained vs lost to the owner, every time a limit or restart interrupted agents.** Run `python3 <path>/loss-report.py <run dir>` for each interrupted workflow run (`--latest` for the newest; run dirs are `~/.claude/projects/<project>/<session>/subagents/workflows/<run-id>/`). Tell the owner, per agent and in total: tokens spent, **% retained** (spent up to the agent's last output that is actually on GitHub) and **% lost** (spent after it, to be redone), in a short table. Be honest about anything rescued by hand (e.g. notes read back from a transcript): name it, but don't count it as retained. Record the totals in CHECKPOINT.md.
4. Before relaunching, look in the transcripts of agents that lost work for unsaved notes the report lists, and save anything useful to the repo.
5. Merge finished agents (run the checks first), then relaunch the rest with `args.done` and `args.resume` pointing at their `wip/` branches.

## CHECKPOINT.md template

```markdown
# Checkpoint (read this first after any pause)

**Last updated:** <date, time UTC>.

## How to resume
1. `cd <repo>`, run `<path>/status.sh`; start the saver if it is stopped.
2. Read "In flight" below; merge finished work, relaunch the rest with the args shown.

## Done
| Area | Where | Notes |

## In flight
<run ID, script, args; each agent: label → worktree → wip/ branch → state>

## Next
<numbered steps>

## Waiting on the owner
<accounts, money, legal, approvals>

## Gotchas learned
```
