"""Helpers for testing api.* functions against the frontend contract.

The JSON Schemas in /contracts are exported from frontend/src/api/contract.ts
(`npm run contracts`). Every api function must return data that validates.
"""

from __future__ import annotations

import json
from functools import cache
from pathlib import Path
from typing import Any

import psycopg
from jsonschema import Draft202012Validator

CONTRACTS = Path(__file__).resolve().parents[2] / "contracts"


@cache
def validator(name: str) -> Draft202012Validator:
    schema = json.loads((CONTRACTS / f"{name}.json").read_text(encoding="utf-8"))
    return Draft202012Validator(schema)


def call(conn: psycopg.Connection, name: str, args: dict[str, Any] | None = None) -> Any:
    """Run select api.<name>(args) and return the JSON value."""
    row = conn.execute(f"select api.{name}(%s::jsonb) as data", (json.dumps(args or {}),)).fetchone()
    assert row is not None
    return row["data"]


def check(name: str, data: Any) -> Any:
    """Assert `data` matches the contract for `name`; returns it for chaining."""
    errors = sorted(validator(name).iter_errors(data), key=lambda e: list(e.path))
    if errors:
        lines = [f"{'/'.join(str(p) for p in e.path) or '(root)'}: {e.message[:200]}" for e in errors[:10]]
        raise AssertionError(f"api.{name} broke the contract:\n" + "\n".join(lines))
    return data
