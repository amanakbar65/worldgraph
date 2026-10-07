"""`wg pipeline …`: the live data jobs (run every 15 minutes by GitHub Actions)."""

from __future__ import annotations

import json
import logging
from datetime import timedelta

import typer

app = typer.Typer(help="Live data: news, forecasts, AI analysis, clean-up.", no_args_is_help=True)


def _print(name: str, result: dict) -> None:
    colour = typer.colors.GREEN if result.get("ok", True) else typer.colors.RED
    typer.secho(f"{name}: {json.dumps(result, default=str)}", fg=colour)


def _embedder():
    from worldgraph.pipeline.embed import FastEmbedder

    return FastEmbedder()


@app.command("run")
def run_all(
    skip_news: bool = typer.Option(False, help="Skip news (e.g. to test forecasts only)."),
) -> None:
    """The scheduled run: news, then forecasts / clean-up / AI analysis when due."""
    from worldgraph.config import get_settings
    from worldgraph.db import connect
    from worldgraph.pipeline import run

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    failed = False
    with connect() as conn:
        if not skip_news:
            embedder = _embedder()
            result = run.logged(conn, "news", lambda: run.run_news(conn, embedder))
            _print("news", result)
            failed |= not result["ok"]
        if run.due(conn, "forecasts", timedelta(minutes=55)):
            from worldgraph.pipeline.forecasts.sync import sync_all

            result = run.logged(conn, "forecasts", lambda: sync_all(conn))
            _print("forecasts", result)
            failed |= not result["ok"]
        if run.due(conn, "prune", timedelta(hours=6)):
            from worldgraph.pipeline.prune import prune

            _print("prune", run.logged(conn, "prune", lambda: prune(conn)))
        if get_settings().anthropic_api_key:
            from worldgraph.pipeline.analysis import run_analysis

            result = run.logged(conn, "analysis", lambda: run_analysis(conn))
            _print("analysis", result)
    if failed:
        raise typer.Exit(1)


@app.command("news")
def news(sources: str = typer.Option("gdelt,rss,hazards", help="Comma-separated sources.")) -> None:
    """Fetch news now and update stories."""
    from worldgraph.db import connect
    from worldgraph.pipeline import run

    embedder = _embedder()
    with connect() as conn:
        _print(
            "news",
            run.logged(conn, "news", lambda: run.run_news(conn, embedder, sources=tuple(sources.split(",")))),
        )


@app.command("forecasts")
def forecasts() -> None:
    """Sync crowd forecasts now."""
    from worldgraph.db import connect
    from worldgraph.pipeline import run
    from worldgraph.pipeline.forecasts.sync import sync_all

    with connect() as conn:
        _print("forecasts", run.logged(conn, "forecasts", lambda: sync_all(conn)))


@app.command("prune")
def prune_cmd() -> None:
    """Apply the retention rules now."""
    from worldgraph.db import connect
    from worldgraph.pipeline import run
    from worldgraph.pipeline.prune import prune

    with connect() as conn:
        _print("prune", run.logged(conn, "prune", lambda: prune(conn)))


@app.command("analyse")
def analyse(limit: int = typer.Option(10, help="Stories to analyse in this run.")) -> None:
    """Run AI analysis on waiting stories (needs ANTHROPIC_API_KEY; respects the daily cap)."""
    from worldgraph.db import connect
    from worldgraph.pipeline import run
    from worldgraph.pipeline.analysis import run_analysis

    with connect() as conn:
        _print("analysis", run.logged(conn, "analysis", lambda: run_analysis(conn, limit=limit)))


@app.command("status")
def status() -> None:
    """The latest run of each job."""
    from worldgraph.db import connect

    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            "select distinct on (job) job, started_at, ok, stats, error from ingest_run "
            "order by job, started_at desc"
        )
        for r in cur.fetchall():
            mark = "ok" if r["ok"] else ("FAILED" if r["ok"] is False else "running")
            typer.echo(
                f"  {r['job']:<10} {r['started_at']:%Y-%m-%d %H:%M} {mark} {json.dumps(r['stats'])[:200]}"
            )
            if r["error"]:
                typer.echo(f"             {r['error'][:300]}")
