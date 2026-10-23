"""The `wg` command. Run `uv run wg --help` to see everything it can do."""

from __future__ import annotations

import typer

app = typer.Typer(
    help="WorldGraph backend tools.",
    no_args_is_help=True,
    add_completion=False,
)
db_app = typer.Typer(help="Database: migrations and status.", no_args_is_help=True)
seed_app = typer.Typer(help="Sample data: check and load.", no_args_is_help=True)
geo_app = typer.Typer(help="Geography: the Natural Earth gazetteer and map layers.", no_args_is_help=True)
schema_app = typer.Typer(
    help="The graph schema (schema/types.yaml): node types and relations.", no_args_is_help=True
)
kg_app = typer.Typer(help="Knowledge graph upkeep: the owner's review list.", no_args_is_help=True)
app.add_typer(db_app, name="db")
app.add_typer(seed_app, name="seed")
app.add_typer(geo_app, name="geo")
app.add_typer(schema_app, name="schema")
app.add_typer(kg_app, name="kg")


def _pipeline_app() -> typer.Typer:
    from worldgraph.pipeline.cli import app as pipeline_app

    return pipeline_app


app.add_typer(_pipeline_app(), name="pipeline")


@db_app.command("migrate")
def db_migrate() -> None:
    """Apply any database migrations that haven't run yet."""
    from worldgraph.db import connect
    from worldgraph.db.migrate import migrate

    with connect() as conn:
        applied = migrate(conn)
    if applied:
        for m in applied:
            typer.secho(f"  applied {m.version}_{m.name}", fg=typer.colors.GREEN)
        typer.echo(f"Done: {len(applied)} migration(s) applied.")
    else:
        typer.echo("Database is already up to date.")


@db_app.command("status")
def db_status() -> None:
    """Show which migrations have been applied."""
    from worldgraph.db import connect
    from worldgraph.db.migrate import applied_versions, list_migrations

    with connect() as conn:
        done = applied_versions(conn)
    for m in list_migrations():
        mark = "applied" if m.version in done else "PENDING"
        typer.echo(f"  {m.version}_{m.name}: {mark}")


@db_app.command("down")
def db_down(
    version: str = typer.Argument(..., help="Undo this migration and every later one (e.g. 0021)."),
    yes: bool = typer.Option(False, "--yes", help="Don't ask for confirmation."),
) -> None:
    """Undo migrations with their down files (newest first). Data in what they added is lost."""
    from worldgraph.db import connect
    from worldgraph.db.migrate import applied_versions, rollback

    with connect() as conn:
        targets = sorted((v for v in applied_versions(conn) if v >= version), reverse=True)
        if not targets:
            typer.echo("Nothing to undo.")
            return
        if not yes:
            typer.confirm(f"Undo {', '.join(targets)}? Their data is dropped.", abort=True)
        for m in rollback(conn, version):
            typer.secho(f"  undid {m.version}_{m.name}", fg=typer.colors.YELLOW)


@schema_app.command("sql")
def schema_sql(
    only: str = typer.Option(None, help="node_types or relation_types (default: both)."),
) -> None:
    """Print the upserts that put schema/types.yaml in the database (paste into a new migration)."""
    from worldgraph.schema import registry_sql

    typer.echo(registry_sql(only=only), nl=False)


@kg_app.command("review")
def kg_review(
    out: str = typer.Option("../docs/kg-review.md", help="Where to write the review list (Markdown)."),
) -> None:
    """Write the owner's review list: leftover facts, unknown keys, rule breaks, relates_to links."""
    from pathlib import Path

    from worldgraph.db import connect
    from worldgraph.schema.review import collect, render

    with connect() as conn:
        data = collect(conn)
    path = Path(out)
    path.write_text(render(data), encoding="utf-8")
    typer.secho(f"Wrote {path}", fg=typer.colors.GREEN)
    for label, value in data["summary"].items():
        typer.echo(f"  {label}: {value}")


@seed_app.command("check")
def seed_check() -> None:
    """Build the sample data in memory and check every rule. No database needed."""
    from worldgraph.seed.build import build_bundle

    bundle = build_bundle()
    typer.secho("Sample data is valid.", fg=typer.colors.GREEN)
    for label, value in bundle.summary().items():
        typer.echo(f"  {label}: {value}")


@seed_app.command("load")
def seed_load(
    if_changed: bool = typer.Option(
        False,
        "--if-changed",
        help="Only reload when the sample data's sources changed since the last load (for the pipeline).",
    ),
) -> None:
    """Replace the sample data in the database (times are set relative to now)."""
    from worldgraph.db import connect
    from worldgraph.seed.build import build_bundle
    from worldgraph.seed.load import load_bundle, loaded_source_hash, record_source_hash, source_hash

    digest = source_hash()
    with connect() as conn:
        if if_changed and loaded_source_hash(conn) == digest:
            typer.echo("Sample data unchanged; not reloaded.")
            return
        counts = load_bundle(conn, build_bundle())
        record_source_hash(conn, digest)
    typer.secho("Sample data loaded.", fg=typer.colors.GREEN)
    for label, value in counts.items():
        typer.echo(f"  {label}: {value}")


@seed_app.command("sql")
def seed_sql(
    out: str = typer.Option("data/seed-sql", help="Folder for the SQL files."),
    max_kb: int = typer.Option(400, help="Largest file size in KB."),
) -> None:
    """Write the sample data as SQL files (to apply through the Supabase connector)."""
    from pathlib import Path

    from worldgraph.seed.build import build_bundle
    from worldgraph.seed.load import write_sql_chunks

    paths = write_sql_chunks(build_bundle(), Path(out), max_kb * 1000)
    typer.secho(f"Wrote {len(paths)} files to {out}/", fg=typer.colors.GREEN)


@geo_app.command("gazetteer")
def geo_gazetteer() -> None:
    """Download Natural Earth and rebuild seed/gazetteer.json."""
    from worldgraph.geo.gazetteer import build_gazetteer

    summary = build_gazetteer()
    typer.secho("Gazetteer rebuilt.", fg=typer.colors.GREEN)
    for label, value in summary.items():
        typer.echo(f"  {label}: {value}")


@geo_app.command("assets")
def geo_assets(
    check: bool = typer.Option(False, "--check", help="Only check the files already built."),
) -> None:
    """Build the map layers in frontend/public/geo/ (run with `uv run --group geo`)."""
    from worldgraph.geo.assets_check import check_assets

    if not check:
        try:
            from worldgraph.geo.assets import build_assets
        except ImportError as exc:
            typer.secho(
                f"Missing geometry libraries ({exc.name}). Run: uv run --group geo wg geo assets",
                fg=typer.colors.RED,
            )
            raise typer.Exit(1) from exc
        summary = build_assets()
        typer.secho(f"Map layers rebuilt in {summary['out']}", fg=typer.colors.GREEN)
        for line in summary["details"]:
            typer.echo(f"  {line}")

    report = check_assets()
    for name, size in report.sizes.items():
        typer.echo(f"  {name}: {size / 1000:,.0f} KB")
    for note in report.notes:
        typer.echo(f"  note: {note}")
    for problem in report.problems:
        typer.secho(f"  problem: {problem}", fg=typer.colors.RED)
    if not report.ok:
        raise typer.Exit(1)
    typer.secho("Map layers match the gazetteer.", fg=typer.colors.GREEN)


@geo_app.command("fips")
def geo_fips() -> None:
    """Rebuild pipeline/data/fips.json (GDELT place codes → our regions)."""
    from worldgraph.geo.fips import build_fips

    summary = build_fips()
    typer.secho("FIPS lookup rebuilt.", fg=typer.colors.GREEN)
    for label, value in summary.items():
        typer.echo(f"  {label}: {value}")


if __name__ == "__main__":
    app()
