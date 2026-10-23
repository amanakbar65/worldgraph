"""The knowledge graph's schema: node types, their properties and named relations.

`types.yaml` (next to this file) is the single source. See `registry.py`.
"""

from worldgraph.schema.registry import (
    NodeType,
    PropertyDef,
    RelationType,
    Schema,
    load_schema,
    property_problems,
    registry_sql,
)

__all__ = [
    "NodeType",
    "PropertyDef",
    "RelationType",
    "Schema",
    "load_schema",
    "property_problems",
    "registry_sql",
]
