#!/usr/bin/env python3
"""Retained vs lost tokens per agent for interrupted workflow runs.

Usage (inside the repo): loss-report.py RUN_DIR... | --latest [N]
Tokens = input + output + new cache writes, each API message once (as the UI counts).
Finished agents are 100% retained. Others: retained = tokens up to the agent's last
output that is on GitHub (a file it wrote present in origin/wip/WORKTREE, or its own
push); the rest is lost and must be redone.
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
        return subprocess.run(["git", *args], capture_output=True, text=True, check=True).stdout.strip()
    except (subprocess.CalledProcessError, FileNotFoundError):
        return ""


def last_remote_save(worktree: str) -> datetime | None:
    name = os.path.basename(worktree.rstrip("/"))
    out = git("log", "-1", "--format=%cI", f"origin/wip/{name}")
    return parse_ts(out) if out else None


def agent_messages(path: str) -> tuple[list[tuple[datetime, int]], list[datetime], list[tuple[datetime, str]]]:
    """[(time, tokens)] per API message, times of `git push`, and [(time, path)] of files written."""
    first_seen: dict[str, datetime] = {}
    usage: dict[str, dict] = {}
    pushes: list[datetime] = []
    writes: list[tuple[datetime, str]] = []
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            try:
                d = json.loads(line)
            except json.JSONDecodeError:
                continue
            m = d.get("message") or {}
            ts = d.get("timestamp")
            if m.get("role") != "assistant" or not ts:
                continue
            mid = m.get("id")
            if mid and m.get("usage"):
                first_seen.setdefault(mid, parse_ts(ts))
                usage[mid] = m["usage"]
            for c in m.get("content") or []:
                if c.get("type") != "tool_use":
                    continue
                inp = c.get("input") or {}
                if "git push" in str(inp.get("command", "")):
                    pushes.append(parse_ts(ts))
                if c.get("name") in ("Write", "Edit", "MultiEdit", "NotebookEdit") and inp.get("file_path"):
                    writes.append((parse_ts(ts), inp["file_path"]))
    msgs = []
    for mid, u in usage.items():
        tokens = (u.get("input_tokens") or 0) + (u.get("output_tokens") or 0) + (u.get("cache_creation_input_tokens") or 0)
        msgs.append((first_seen[mid], tokens))
    return sorted(msgs), pushes, writes


def saved_files(worktree: str) -> set[str]:
    """Absolute paths of files that differ from main in the saved origin/wip/<worktree> branch."""
    name = os.path.basename(worktree.rstrip("/"))
    base = git("merge-base", "origin/HEAD", f"origin/wip/{name}") or git("merge-base", "origin/main", f"origin/wip/{name}")
    if not base:
        return set()
    names = git("diff", "--name-only", base, f"origin/wip/{name}").splitlines()
    return {os.path.join(worktree, n) for n in names if n}


def report(run_dir: str) -> tuple[int, int]:
    status: dict[str, str] = {}
    journal = os.path.join(run_dir, "journal.jsonl")
    if os.path.exists(journal):
        for line in open(journal, encoding="utf-8"):
            try:
                e = json.loads(line)
            except json.JSONDecodeError:
                continue
            if e.get("agentId") and e.get("type") in ("result", "failed", "started"):
                if status.get(e["agentId"]) != "result":
                    status[e["agentId"]] = e["type"]
    rows, kept_total, lost_total = [], 0, 0
    for meta_path in sorted(glob.glob(os.path.join(run_dir, "agent-*.meta.json"))):
        agent_id = os.path.basename(meta_path)[len("agent-"):-len(".meta.json")]
        meta = json.load(open(meta_path, encoding="utf-8"))
        label = meta.get("description") or agent_id
        msgs, pushes, writes = agent_messages(meta_path.replace(".meta.json", ".jsonl"))
        total = sum(t for _, t in msgs)
        if total == 0:
            continue
        worktree = meta.get("worktreePath") or ""
        if status.get(agent_id) == "result":
            kept, note = total, "finished"
        else:
            # Work is retained up to the agent's last output that is actually on GitHub:
            # a file it wrote that is in its saved wip/ branch, or anything before its own push.
            save = last_remote_save(worktree) if worktree else None
            on_remote = saved_files(worktree) if save else set()
            captured = [ts for ts, path in writes if save and ts <= save and path in on_remote]
            point = max(captured + pushes) if (captured or pushes) else None
            kept = sum(t for ts, t in msgs if point and ts <= point)
            unsaved_notes = sorted({os.path.basename(p) for ts, p in writes if p not in on_remote and (point is None or ts > point)})
            note = f"saved to {point:%H:%M} UTC" if point else "nothing saved"
            if unsaved_notes:
                note += f"; unsaved (in transcript): {', '.join(unsaved_notes[:3])}"
        rows.append((label, total, kept, note))
        kept_total += kept
        lost_total += total - kept
    print(f"{os.path.basename(run_dir.rstrip('/'))} | tokens | retained | lost | note")
    for label, total, kept, note in rows:
        print(f"{label[:24]} | {total/1e5:.1f}L | {100*kept/total:.0f}% | {100*(total-kept)/total:.0f}% | {note}")
    spent = kept_total + lost_total
    if spent:
        print(f"TOTAL | {spent/1e5:.1f}L | {100*kept_total/spent:.0f}% | {100*lost_total/spent:.0f}% |")
    else:
        print("no tokens spent")
    return kept_total, lost_total


def main() -> None:
    args = sys.argv[1:]
    if not args:
        sys.exit(__doc__)
    git("fetch", "-q", "origin")
    if args[0] == "--latest":
        n = int(args[1]) if len(args) > 1 else 1
        runs = sorted(glob.glob(os.path.expanduser("~/.claude/projects/*/*/subagents/workflows/wf_*")), key=os.path.getmtime)
        args = runs[-n:]
    kept = lost = 0
    for run_dir in args:
        k, l_ = report(run_dir)
        kept, lost = kept + k, lost + l_
    if len(args) > 1 and kept + lost:
        print(f"ALL RUNS | {(kept+lost)/1e5:.1f}L | {100*kept/(kept+lost):.0f}% | {100*lost/(kept+lost):.0f}% |")
    if not args:
        print("no workflow transcripts found (new container?): report saved work from status.sh")


if __name__ == "__main__":
    main()
