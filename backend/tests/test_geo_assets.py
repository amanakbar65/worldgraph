"""The committed map layers (frontend/public/geo/) match the gazetteer.

Rebuild them with `uv run --group geo wg geo assets`; this check needs no
geometry libraries.
"""

from worldgraph.geo.assets_check import check_assets, ring_problems


def test_map_layers_match_the_gazetteer():
    report = check_assets()
    assert report.problems == []


def _shape(region: str, ring: list[list[float]]) -> dict:
    return {"properties": {"id": region}, "geometry": {"type": "Polygon", "coordinates": [ring]}}


def test_ring_problems_finds_collapsed_and_backwards_rings():
    ccw = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]
    good = _shape("region:aa", ccw)
    backwards = _shape("region:bb", ccw[::-1])
    collapsed = _shape("region:cc", [[2, 2], [2, 2]])
    assert ring_problems([good]) == []
    assert ring_problems([backwards]) == ["region:bb has a ring wound the wrong way"]
    assert ring_problems([collapsed]) == ["region:cc has a collapsed or open ring"]
