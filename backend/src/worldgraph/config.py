"""App settings, read from environment variables and the .env file.

The .env file can live in the repo root (recommended) or in backend/.
Real environment variables always win over values in .env.
"""

from functools import lru_cache
from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[2]
REPO_DIR = BACKEND_DIR.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(REPO_DIR / ".env", BACKEND_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    database_url: str | None = None
    wg_env: str = "development"
    wg_dev_viewer_country: str | None = None

    @field_validator("database_url", "wg_dev_viewer_country", mode="before")
    @classmethod
    def _blank_is_none(cls, value: object) -> object:
        if isinstance(value, str) and not value.strip():
            return None
        return value

    @property
    def database_configured(self) -> bool:
        # The placeholder copied from .env.example doesn't count as configured.
        return bool(self.database_url) and "YOUR_PASSWORD" not in (self.database_url or "")


@lru_cache
def get_settings() -> Settings:
    return Settings()
