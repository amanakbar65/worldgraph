from fastapi.testclient import TestClient

from worldgraph.api.main import app
from worldgraph.config import Settings


def test_health_without_database():
    with TestClient(app) as client:
        response = client.get("/api/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["database"]["status"] == "not_configured"


def test_placeholder_database_url_counts_as_not_configured():
    settings = Settings(database_url="postgresql://postgres.ref:YOUR_PASSWORD@host:5432/postgres")
    assert not settings.database_configured


def test_blank_values_become_none():
    settings = Settings(database_url="  ", wg_dev_viewer_country="")
    assert settings.database_url is None
    assert settings.wg_dev_viewer_country is None
