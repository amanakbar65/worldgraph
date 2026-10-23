"""Load and check `types.yaml`, write its SQL, and validate property values.

The same validation rules live in SQL (`api._property_problems`, migration
0021); tests/test_schema.py runs both on the same cases so they stay equal.
"""

from __future__ import annotations

import json
import re
from collections.abc import Callable, Mapping
from datetime import date
from functools import cache
from pathlib import Path
from typing import Any, Literal

import yaml
from pydantic import BaseModel, ConfigDict, field_validator, model_validator

TYPES_YAML = Path(__file__).parent / "types.yaml"

Kind = Literal["text", "number", "date", "choice", "url", "place", "entity"]
KINDS: tuple[str, ...] = ("text", "number", "date", "choice", "url", "place", "entity")

KEY_RE = re.compile(r"^[a-z][a-z0-9_]*$")
CHOICE_RE = re.compile(r"^[a-z0-9][a-z0-9_-]*$")
ID_RE = re.compile(r"^[a-z_]+:[a-z0-9][a-z0-9.-]*$")
DATE_RE = re.compile(r"^\d{4}(-\d{2}(-\d{2})?)?$")
URL_RE = re.compile(r"^https?://\S+$")
TEXT_MAX = 300
URL_MAX = 500


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class Choice(_Strict):
    key: str
    label: str

    @field_validator("key")
    @classmethod
    def _key(cls, v: str) -> str:
        if not CHOICE_RE.match(v):
            raise ValueError(f"bad choice key {v!r}")
        return v


class PropertyDef(_Strict):
    key: str
    label: str
    kind: Kind
    required: bool = False
    derived: bool = False
    multiple: bool = False
    choices: list[Choice] | None = None
    unit: str | None = None
    unit_key: str | None = None
    entity_types: list[str] | None = None
    pattern: str | None = None
    min: int | float | None = None
    max: int | float | None = None
    description: str | None = None

    @field_validator("key")
    @classmethod
    def _key(cls, v: str) -> str:
        if not KEY_RE.match(v):
            raise ValueError(f"bad property key {v!r} (lowercase letters, digits and _)")
        return v

    @model_validator(mode="after")
    def _consistent(self) -> PropertyDef:
        where = f"property {self.key}"
        if (self.kind == "choice") != bool(self.choices):
            raise ValueError(f"{where}: choices go with kind choice, and only with it")
        if self.entity_types is not None and self.kind != "entity":
            raise ValueError(f"{where}: entity_types go with kind entity")
        if self.pattern is not None:
            if self.kind != "text":
                raise ValueError(f"{where}: pattern goes with kind text")
            re.compile(self.pattern)
        if (
            self.min is not None or self.max is not None or self.unit or self.unit_key
        ) and self.kind != "number":
            raise ValueError(f"{where}: min, max, unit and unit_key go with kind number")
        if self.unit and self.unit_key:
            raise ValueError(f"{where}: give unit or unit_key, not both")
        if self.required and self.derived:
            raise ValueError(f"{where}: a derived property can't be required")
        if self.choices and len({c.key for c in self.choices}) != len(self.choices):
            raise ValueError(f"{where}: repeated choice")
        return self

    def db(self) -> dict[str, Any]:
        """The object stored in node_type.properties (and sent by api.schema)."""
        out: dict[str, Any] = {
            "key": self.key,
            "label": self.label,
            "kind": self.kind,
            "required": self.required,
            "derived": self.derived,
            "multiple": self.multiple,
        }
        if self.choices:
            out["choices"] = [{"key": c.key, "label": c.label} for c in self.choices]
        for name in ("unit", "unit_key", "entity_types", "pattern", "min", "max", "description"):
            value = getattr(self, name)
            if value is not None:
                out[name] = value
        return out


class NodeType(_Strict):
    key: str
    label: str
    plural: str
    icon: str
    tone: str
    description: str
    properties: list[PropertyDef] = []

    @field_validator("key")
    @classmethod
    def _key(cls, v: str) -> str:
        if not re.match(r"^[a-z_]+$", v):
            raise ValueError(f"bad type key {v!r}")
        return v

    @model_validator(mode="after")
    def _props(self) -> NodeType:
        keys = [p.key for p in self.properties]
        if len(keys) != len(set(keys)):
            raise ValueError(f"type {self.key}: a property key is repeated")
        by_key = {p.key: p for p in self.properties}
        for p in self.properties:
            if p.unit_key and (p.unit_key not in by_key or by_key[p.unit_key].kind != "text"):
                raise ValueError(f"type {self.key}: {p.key}.unit_key must name a text property")
        return self

    def prop(self, key: str) -> PropertyDef | None:
        return next((p for p in self.properties if p.key == key), None)


class RelationType(_Strict):
    key: str
    label: str
    inverse_label: str
    icon: str
    causal: bool = False
    symmetric: bool = False
    src_types: list[str] = []
    dst_types: list[str] = []
    description: str

    @field_validator("key")
    @classmethod
    def _key(cls, v: str) -> str:
        if not KEY_RE.match(v):
            raise ValueError(f"bad relation key {v!r}")
        return v

    @model_validator(mode="after")
    def _symmetric(self) -> RelationType:
        if self.symmetric and self.label != self.inverse_label:
            raise ValueError(f"relation {self.key}: a symmetric relation reads the same both ways")
        if self.symmetric and self.src_types != self.dst_types:
            raise ValueError(f"relation {self.key}: a symmetric relation allows the same types at both ends")
        return self

    def allows(self, src_type: str, dst_type: str) -> bool:
        def ok(types: list[str], t: str) -> bool:
            return not types or t in types

        forward = ok(self.src_types, src_type) and ok(self.dst_types, dst_type)
        return forward or (self.symmetric and ok(self.src_types, dst_type) and ok(self.dst_types, src_type))


class Schema(_Strict):
    node_types: list[NodeType]
    relation_types: list[RelationType]

    @model_validator(mode="after")
    def _refs(self) -> Schema:
        types = [t.key for t in self.node_types]
        if len(types) != len(set(types)):
            raise ValueError("a node type is repeated")
        rels = [r.key for r in self.relation_types]
        if len(rels) != len(set(rels)):
            raise ValueError("a relation type is repeated")
        known = set(types)
        for t in self.node_types:
            for p in t.properties:
                for et in p.entity_types or []:
                    if et not in known:
                        raise ValueError(f"type {t.key}: {p.key} names unknown type {et}")
        for r in self.relation_types:
            for et in [*r.src_types, *r.dst_types]:
                if et not in known:
                    raise ValueError(f"relation {r.key}: unknown type {et}")
        return self

    def node_type(self, key: str) -> NodeType | None:
        return next((t for t in self.node_types if t.key == key), None)

    def relation(self, key: str) -> RelationType | None:
        return next((r for r in self.relation_types if r.key == key), None)

    # Rows as the database holds them (tests compare these with the tables).
    def node_type_rows(self) -> list[dict[str, Any]]:
        return [
            {
                "key": t.key,
                "label": t.label,
                "plural": t.plural,
                "icon": t.icon,
                "tone": t.tone,
                "description": t.description,
                "properties": [p.db() for p in t.properties],
                "ord": i,
            }
            for i, t in enumerate(self.node_types, start=1)
        ]

    def relation_type_rows(self) -> list[dict[str, Any]]:
        return [
            {
                "key": r.key,
                "label": r.label,
                "inverse_label": r.inverse_label,
                "icon": r.icon,
                "causal": r.causal,
                "symmetric": r.symmetric,
                "src_types": list(r.src_types),
                "dst_types": list(r.dst_types),
                "description": r.description,
                "ord": i,
            }
            for i, r in enumerate(self.relation_types, start=1)
        ]


@cache
def load_schema(path: Path = TYPES_YAML) -> Schema:
    raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    return Schema.model_validate(raw)


# ---------------------------------------------------------------------------
# SQL
# ---------------------------------------------------------------------------


def _q(value: Any, sql_type: str = "text") -> str:
    if value is None:
        return "null"
    if sql_type == "jsonb":
        return _q(json.dumps(value, ensure_ascii=False)) + "::jsonb"
    if sql_type == "text[]":
        return "array[" + ", ".join(_q(v) for v in value) + "]::text[]" if value else "'{}'::text[]"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int):
        return str(value)
    return "'" + str(value).replace("'", "''") + "'"


_NODE_COLS = ("key", "label", "plural", "icon", "tone", "description", "properties", "ord")
_REL_COLS = (
    "key",
    "label",
    "inverse_label",
    "icon",
    "causal",
    "symmetric",
    "src_types",
    "dst_types",
    "description",
    "ord",
)
_SQL_TYPES = {"properties": "jsonb", "src_types": "text[]", "dst_types": "text[]"}


_RESERVED = {"symmetric"}  # SQL keywords: quoted as column names


def _col(name: str) -> str:
    return f'"{name}"' if name in _RESERVED else name


def _upsert(table: str, cols: tuple[str, ...], rows: list[dict[str, Any]]) -> str:
    values = ",\n".join(
        "    (" + ", ".join(_q(r[c], _SQL_TYPES.get(c, "text")) for c in cols) + ")" for r in rows
    )
    updates = ", ".join(f"{_col(c)} = excluded.{_col(c)}" for c in cols[1:])
    return (
        f"insert into {table} ({', '.join(_col(c) for c in cols)}) values\n{values}\n"
        f"on conflict (key) do update set {updates};\n"
    )


def registry_sql(schema: Schema | None = None, only: str | None = None) -> str:
    """The upserts that make the registry tables match types.yaml."""
    schema = schema or load_schema()
    parts = []
    if only in (None, "node_types"):
        parts.append(_upsert("node_type", _NODE_COLS, schema.node_type_rows()))
    if only in (None, "relation_types"):
        parts.append(_upsert("relation_type", _REL_COLS, schema.relation_type_rows()))
    if not parts:
        raise ValueError("only must be node_types or relation_types")
    return "\n".join(parts)


# ---------------------------------------------------------------------------
# Validation (mirrors api._property_problems)
# ---------------------------------------------------------------------------


def _num(v: int | float) -> str:
    return f"{v:g}" if isinstance(v, float) else str(v)


def _valid_date(text: str) -> bool:
    if not DATE_RE.match(text):
        return False
    parts = [int(x) for x in text.split("-")]
    try:
        date(parts[0], parts[1] if len(parts) > 1 else 1, parts[2] if len(parts) > 2 else 1)
    except ValueError:
        return False
    return True


def value_problem(p: PropertyDef, value: Any, resolve: Callable[[str], str | None]) -> str | None:
    """Why one value doesn't fit `p` (None when it does). `resolve(id)` gives a node's type."""
    if p.kind == "text":
        if not isinstance(value, str) or not value.strip():
            return "must be text"
        if len(value) > TEXT_MAX:
            return f"must be at most {TEXT_MAX} characters"
        if p.pattern and not re.search(p.pattern, value):
            return "is not in the expected format"
        return None
    if p.kind == "number":
        if isinstance(value, bool) or not isinstance(value, int | float):
            return "must be a number"
        if p.min is not None and value < p.min:
            return f"must be at least {_num(p.min)}"
        if p.max is not None and value > p.max:
            return f"must be at most {_num(p.max)}"
        return None
    if p.kind == "date":
        if not isinstance(value, str) or not _valid_date(value):
            return "must be a date (YYYY, YYYY-MM or YYYY-MM-DD)"
        return None
    if p.kind == "choice":
        keys = [c.key for c in p.choices or []]
        if not isinstance(value, str) or value not in keys:
            return "must be one of: " + ", ".join(keys)
        return None
    if p.kind == "url":
        if not isinstance(value, str) or len(value) > URL_MAX or not URL_RE.match(value):
            return "must be an http(s) link"
        return None
    # place / entity: a node id that exists, of an allowed type
    if not isinstance(value, str) or not ID_RE.match(value):
        return "must be a place id" if p.kind == "place" else "must be an entity id"
    found = resolve(value)
    if p.kind == "place":
        return None if found == "region" else f"unknown place {value}"
    if found is None:
        return f"unknown entity {value}"
    if p.entity_types and found not in p.entity_types:
        return "must be one of these types: " + ", ".join(p.entity_types)
    return None


def property_problems(
    schema: Schema,
    type_key: str,
    properties: Mapping[str, Any] | Any,
    resolve: Callable[[str], str | None],
) -> list[str]:
    """Every problem with a node's properties, in definition order ([] when valid).

    Unknown keys are allowed (the review list shows them). Derived
    properties can't be stored. `resolve(id)` returns a node's type or None.
    """
    t = schema.node_type(type_key)
    if t is None:
        return [f"unknown type {type_key}"]
    if not isinstance(properties, Mapping):
        return ["properties must be an object"]
    problems: list[str] = []
    for p in t.properties:
        value = properties.get(p.key)
        if p.derived:
            if value is not None:
                problems.append(f"{p.key}: is read-only (worked out automatically)")
            continue
        if value is None:
            if p.required:
                problems.append(f"{p.key}: is required")
            continue
        if p.multiple:
            if not isinstance(value, list) or not value:
                problems.append(f"{p.key}: must be a list")
                continue
            values = value
        else:
            values = [value]
        for v in values:
            problem = value_problem(p, v, resolve)
            if problem:
                problems.append(f"{p.key}: {problem}")
                break
    return problems
