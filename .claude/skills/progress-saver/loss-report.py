#!/usr/bin/env python3
"""Work saved vs lost per agent for interrupted runs (not tokens: the owner cares about the work).

Usage (inside the repo): loss-report.py RUN_DIR... | --latest [N]
RUN_DIR holds agent-*.meta.json and agent-*.jsonl (a workflow run dir, or a folder of links
to Agent-tool transcripts in ~/.claude/projects/*/*/subagents/).

Work = the lines an agent wrote into files in its worktree (each Write counts its lines,
each Edit the lines of its new text). A change is saved if the file is in the agent's
origin/wip/WORKTREE branch and the change was made before that branch's last save.
Finished agents are 100% saved. Scratch files outside the worktree are not counted.
Commands run after the last save (tests, checks, screenshots) are listed: they must be rerun.
"""

from __future__ import annotations

import glob
import json
import os
import subprocess
import sys
from datetime import datetime


def parse_ts(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def git(*args: str) -> str:
    try:
        return subprocess.run(
            ["git", *args], capture_output=True, text=True, check=True
        ).stdout.strip()
    except (subprocess.CalledProcessError, FileNotFoundError):
        return ""


def last_remote_save(worktree: str) -> datetime | None:
    name = os.path.basename(worktree.rstrip("/"))
    out = git("log", "-1", "--format=%cI", f"origin/wip/{name}")
    return parse_ts(out) if out else None


def saved_files(worktree: str) -> set[str]:
    """Absolute paths of files that differ from main in the saved origin/wip/<worktree> branch."""
    name = os.path.basename(worktree.rstrip("/"))
    base = git("merge-base", "origin/HEAD", f"origin/wip/{name}") or git(
        "merge-base", "origin/main", f"origin/wip/{name}"
    )
    if not base:
        return set()
    names = git("diff", "--name-only", base, f"origin/wip/{name}").splitlines()
    return {os.path.join(worktree, n) for n in names if n}


def saved_commits(worktree: str) -> int:
    """The agent's own commits (not saver snapshots) in its saved wip branch."""
    name = os.path.basename(worktree.rstrip("/"))
    subjects = git("log", "--format=%s", f"origin/main..origin/wip/{name}").splitlines()
    return sum(1 for s in subjects if s and not s.startswith("WIP snapshot"))


def lines_of(name: str, inp: dict) -> int:
    if name == "Write":
        return max(1, len(str(inp.get("content", "")).splitlines()))
    if name == "MultiEdit":
        return max(
            1,
            sum(
                len(str(e.get("new_string", "")).splitlines())
                for e in inp.get("edits") or []
            ),
        )
    if name == "NotebookEdit":
        return max(1, len(str(inp.get("new_source", "")).splitlines()))
    return max(1, len(str(inp.get("new_string", "")).splitlines()))


def agent_actions(path: str) -> tuple[list[tuple[datetime, str, int]], list[datetime]]:
    """[(time, file, lines)] for each file change that succeeded, and the times of shell commands."""
    writes: dict[str, tuple[datetime, str, int]] = {}
    failed: set[str] = set()
    commands: list[datetime] = []
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            try:
                d = json.loads(line)
            except json.JSONDecodeError:
                continue
            m = d.get("message") or {}
            ts = d.get("timestamp")
            content = m.get("content") if isinstance(m.get("content"), list) else []
            if m.get("role") == "user":
                failed.update(
                    c.get("tool_use_id", "")
                    for c in content
                    if c.get("type") == "tool_result" and c.get("is_error")
                )
                continue
            if m.get("role") != "assistant" or not ts:
                continue
            for c in content:
                if c.get("type") != "tool_use":
                    continue
                name, inp = c.get("name"), c.get("input") or {}
                target = inp.get("file_path") or inp.get("notebook_path")
                if name in ("Write", "Edit", "MultiEdit", "NotebookEdit") and target:
                    writes[c.get("id", "")] = (
                        parse_ts(ts),
                        target,
                        lines_of(name, inp),
                    )
                elif name == "Bash":
                    commands.append(parse_ts(ts))
    return [w for i, w in writes.items() if i not in failed], commands


def report(run_dir: str) -> tuple[int, int]:
    status: dict[str, str] = {}
    journal = os.path.join(run_dir, "journal.jsonl")
    if os.path.exists(journal):
        with open(journal, encoding="utf-8") as fh:
            for line in fh:
                try:
                    e = json.loads(line)
                except json.JSONDecodeError:
                    continue
                kind = e.get("type")
                if (
                    e.get("agentId")
                    and kind in ("result", "failed", "started")
                    and status.get(e["agentId"]) != "result"
                ):
                    status[e["agentId"]] = kind
    rows, saved_total, lost_total = [], 0, 0
    for meta_path in sorted(glob.glob(os.path.join(run_dir, "agent-*.meta.json"))):
        agent_id = os.path.basename(meta_path)[len("agent-") : -len(".meta.json")]
        with open(meta_path, encoding="utf-8") as fh:
            meta = json.load(fh)
        label = meta.get("description") or agent_id
        worktree = os.path.realpath(meta.get("worktreePath") or "")
        writes, commands = agent_actions(meta_path.replace(".meta.json", ".jsonl"))
        if not writes and not commands:
            continue
        inside = [
            (ts, os.path.realpath(p), n)
            for ts, p, n in writes
            if worktree and os.path.realpath(p).startswith(worktree + os.sep)
        ]
        total = sum(n for _, _, n in inside)
        if status.get(agent_id) == "result":
            saved, note = total, "finished"
        else:
            save = last_remote_save(worktree) if worktree else None
            on_remote = saved_files(worktree) if save else set()
            kept = [
                (ts, p, n)
                for ts, p, n in inside
                if save and ts <= save and p in on_remote
            ]
            saved = sum(n for _, _, n in kept)
            lost_files = sorted(
                {os.path.basename(p) for ts, p, n in inside if (ts, p, n) not in kept}
            )
            parts = [
                f"{saved_commits(worktree)} commits and {saved:,} of {total:,} changed lines saved"
                + (f" (to {save:%d %b %H:%M} UTC)" if save else "")
            ]
            if lost_files:
                parts.append(
                    f"lost edits in: {', '.join(lost_files[:4])}"
                    + (" …" if len(lost_files) > 4 else "")
                )
            after = sum(1 for ts in commands if not save or ts > save)
            if after:
                parts.append(
                    f"{after} commands after the last save (tests, checks, screenshots) to rerun"
                )
            note = "; ".join(parts)
        rows.append((label, total, saved, note))
        saved_total += saved
        lost_total += total - saved
    print(f"{os.path.basename(run_dir.rstrip('/'))} | work saved | work lost | details")
    for label, total, saved, note in rows:
        pct = (
            f"{100 * saved / total:.0f}% | {100 * (total - saved) / total:.0f}%"
            if total
            else "– | –"
        )
        print(
            f"{label[:40]} | {pct} | {note if total else 'no file changes (reading or reviewing); ' + note}"
        )
    done = saved_total + lost_total
    if done:
        print(
            f"TOTAL | {100 * saved_total / done:.0f}% | {100 * lost_total / done:.0f}% | {saved_total:,} of {done:,} changed lines saved"
        )
    else:
        print("no file changes in this run")
    return saved_total, lost_total


def main() -> None:
    args = sys.argv[1:]
    if not args:
        sys.exit(__doc__)
    git("fetch", "-q", "origin")
    if args[0] == "--latest":
        n = int(args[1]) if len(args) > 1 else 1
        runs = sorted(
            glob.glob(
                os.path.expanduser("~/.claude/projects/*/*/subagents/workflows/wf_*")
            ),
            key=os.path.getmtime,
        )
        args = runs[-n:]
    saved = lost = 0
    for run_dir in args:
        s, l_ = report(run_dir)
        saved, lost = saved + s, lost + l_
    if len(args) > 1 and saved + lost:
        print(
            f"ALL RUNS | {100 * saved / (saved + lost):.0f}% | {100 * lost / (saved + lost):.0f}% | {saved:,} of {saved + lost:,} changed lines saved"
        )
    if not args:
        print(
            "no workflow transcripts found (new container?): report saved work from status.sh"
        )


if __name__ == "__main__":
    main()
