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
geo_app = typer.Typer(help="Geography: the Natural Earth gazetteer.", no_args_is_help=True)
app.add_typer(db_app, name="db")
app.add_typer(seed_app, name="seed")
app.add_typer(geo_app, name="geo")


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


@seed_app.command("check")
def seed_check() -> None:
    """Build the sample data in memory and check every rule. No database needed."""
    from worldgraph.seed.build import build_bundle

    bundle = build_bundle()
    typer.secho("Sample data is valid.", fg=typer.colors.GREEN)
    for label, value in bundle.summary().items():
        typer.echo(f"  {label}: {value}")


@seed_app.command("load")
def seed_load() -> None:
    """Replace the sample data in the database (times are set relative to now)."""
    from worldgraph.db import connect
    from worldgraph.seed.build import build_bundle
    from worldgraph.seed.load import load_bundle

    bundle = build_bundle()
    with connect() as conn:
        counts = load_bundle(conn, bundle)
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


if __name__ == "__main__":
    app()
