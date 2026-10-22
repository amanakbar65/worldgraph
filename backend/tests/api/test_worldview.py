"""India's view in search and the region panel (migration 0018).

With `worldview: "india"`, the regions India counts as its own (the area
Pakistan calls Azad Kashmir, and Gilgit-Baltistan) appear as their Indian
parent, never as "· Pakistan". Without it, nothing changes.
"""

from __future__ import annotations

from typing import Any

import pytest

from tests.contract import call, check

INDIA = {"worldview": "india"}
MOVED = {"region:pk-jk": "region:in-jk", "region:pk-gb": "region:in-la"}


def results(data: dict[str, Any]) -> list[tuple[str, str, str]]:
    return [(r["id"], r["name"], r["context"]) for r in data["results"]]


@pytest.mark.parametrize("q", ["Kashmir", "Azad Kashmir", "Northern Areas", "Ladakh"])
def test_search_in_indias_view_never_says_pakistan_for_indian_claims(sdb, q):
    data = check("search", call(sdb, "search", {"q": q, **INDIA}))
    found = [r["id"] for r in data["results"]]
    assert not set(found) & set(MOVED), found
    assert len(found) == len(set(found))
    for rid, _name, context in results(data):
        if rid in MOVED.values():
            assert context == "State · India"


def test_search_shows_the_indian_parent_in_the_place_of_the_claimed_region(sdb):
    world = results(call(sdb, "search", {"q": "Azad Kashmir"}))
    assert world[0] == ("region:pk-jk", "Azad Kashmir", "State · Pakistan")
    india = results(call(sdb, "search", {"q": "Azad Kashmir", **INDIA}))
    assert india[0] == ("region:in-jk", "Jammu and Kashmir", "State · India")
    gb = results(call(sdb, "search", {"q": "Northern Areas", **INDIA}))
    assert gb[0] == ("region:in-la", "Ladakh", "State · India")


def test_search_without_a_worldview_is_unchanged(sdb):
    for args in ({}, {"worldview": "international"}, {"worldview": ""}):
        assert call(sdb, "search", {"q": "Kashmir", **args}) == call(sdb, "_search_world", {"q": "Kashmir"})


@pytest.mark.parametrize(
    ("claimed", "parent", "name"),
    [
        ("region:pk-jk", "region:in-jk", "Jammu and Kashmir"),
        ("region:pk-gb", "region:in-la", "Ladakh"),
    ],
)
def test_region_panel_opens_the_indian_parent(sdb, claimed, parent, name):
    data = check("region", call(sdb, "region", {"id": claimed, "window": "7d", **INDIA}))
    assert (data["region"]["id"], data["region"]["name"]) == (parent, name)
    assert [b["id"] for b in data["region"]["breadcrumb"]] == ["region:in"]
    # The international view keeps Pakistan's breadcrumb.
    world = call(sdb, "region", {"id": claimed, "window": "7d"})
    assert world["region"]["id"] == claimed
    assert [b["id"] for b in world["region"]["breadcrumb"]] == ["region:pk"]


def test_pakistan_page_leaves_out_the_claimed_regions_in_indias_view(sdb):
    india = check("region", call(sdb, "region", {"id": "region:pk", "window": "30d", **INDIA}))
    ids = {c["id"] for c in india["children"]}
    nodes = {n["id"] for n in india["graph"]["nodes"]}
    ends = {e for link in india["graph"]["links"] for e in (link["source"], link["target"])}
    assert not (ids | nodes | ends) & set(MOVED)
    world = call(sdb, "region", {"id": "region:pk", "window": "30d"})
    assert set(MOVED) <= {c["id"] for c in world["children"]}


def test_other_regions_are_the_same_in_both_views(sdb):
    for rid in ("region:in", "region:in-jk", "region:cn", "region:eu"):
        args = {"id": rid, "window": "7d", "sample": True}
        assert call(sdb, "region", {**args, **INDIA}) == call(sdb, "region", args)
