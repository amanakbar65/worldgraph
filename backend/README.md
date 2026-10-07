# WorldGraph backend

Python 3.12, managed with [uv](https://docs.astral.sh/uv/). Run every command from this `backend` folder.

| What | Command |
| --- | --- |
| Install or refresh dependencies | `uv sync` |
| Apply database migrations | `uv run wg db migrate` |
| Load or refresh the sample data | `uv run wg seed load` |
| Check the sample data without a database | `uv run wg seed check` |
| Run tests (needs `TEST_DATABASE_URL`, see `../CLAUDE.md`) | `uv run pytest` |
| Fetch live news, hazards and forecasts once | `uv run --group pipeline wg pipeline run` |
| Show the latest pipeline runs | `uv run wg pipeline status` |
| Lint and format | `uv run ruff check .` and `uv run ruff format .` |

Settings come from the `.env` file in the repo root. See `../.env.example`.
