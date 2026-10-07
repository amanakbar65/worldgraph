"""Find our known entities (companies, commodities, ports, policies) in headlines."""

from __future__ import annotations

import re
from collections.abc import Iterable

import psycopg

ENTITY_TYPES = ("organization", "commodity", "infrastructure", "policy")
# Aliases too vague to mean one entity on their own.
_TOO_VAGUE = {"power", "gas", "chips", "oil", "steel", "rice", "gold", "the fed"}


class EntityMatcher:
    def __init__(self, rows: Iterable[tuple[str, str, list[str]]]) -> None:
        exact: dict[str, str] = {}  # case-sensitive (acronyms)
        folded: dict[str, str] = {}  # case-insensitive
        for entity_id, name, aliases in rows:
            for label in [name, *(aliases or [])]:
                label = label.strip()
                if len(label) < 2 or label.lower() in _TOO_VAGUE:
                    continue
                if len(label) <= 4 and label.isupper():
                    exact.setdefault(label, entity_id)
                else:
                    folded.setdefault(label.lower(), entity_id)
        self._exact = exact
        self._folded = folded
        self._exact_re = self._compile(exact, 0)
        self._folded_re = self._compile(folded, re.IGNORECASE)

    @staticmethod
    def _compile(labels: dict[str, str], flags: int) -> re.Pattern[str] | None:
        if not labels:
            return None
        body = "|".join(re.escape(label) for label in sorted(labels, key=len, reverse=True))
        return re.compile(rf"(?<![\w-])(?:{body})(?![\w-])", flags)

    def match(self, text: str) -> list[str]:
        found: list[str] = []
        if self._exact_re:
            for m in self._exact_re.finditer(text):
                found.append(self._exact[m.group(0)])
        if self._folded_re:
            for m in self._folded_re.finditer(text):
                found.append(self._folded[m.group(0).lower()])
        return list(dict.fromkeys(found))


def load_matcher(conn: psycopg.Connection) -> EntityMatcher:
    with conn.cursor() as cur:
        cur.execute(
            "select id, name, aliases from node where type = any(%s) and not is_sample",
            (list(ENTITY_TYPES),),
        )
        return EntityMatcher((r["id"], r["name"], r["aliases"]) for r in cur.fetchall())
