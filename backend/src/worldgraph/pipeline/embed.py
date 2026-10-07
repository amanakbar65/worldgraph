"""Headline embeddings for clustering (multilingual, 768 dimensions).

The model (paraphrase-multilingual-mpnet-base-v2, about 1 GB) downloads on
first use; CI caches it. Tests use HashEmbedder, which needs no model.
"""

from __future__ import annotations

import hashlib
import math
import os
import re
from typing import Protocol

DIM = 768
MODEL = "sentence-transformers/paraphrase-multilingual-mpnet-base-v2"


class Embedder(Protocol):
    def embed(self, texts: list[str]) -> list[list[float]]: ...


def normalise(vector: list[float]) -> list[float]:
    norm = math.sqrt(sum(v * v for v in vector)) or 1.0
    return [v / norm for v in vector]


class FastEmbedder:
    def __init__(self, model: str = MODEL, cache_dir: str | None = None) -> None:
        from fastembed import TextEmbedding

        self._model = TextEmbedding(
            model_name=model,
            cache_dir=cache_dir or os.environ.get("FASTEMBED_CACHE_PATH"),
            threads=os.cpu_count(),
        )

    def embed(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
        return [normalise([float(x) for x in v]) for v in self._model.embed(texts, batch_size=64)]


class HashEmbedder:
    """Bag of words hashed into DIM buckets: same words → similar vectors."""

    def embed(self, texts: list[str]) -> list[list[float]]:
        out = []
        for text in texts:
            v = [0.0] * DIM
            for word in re.findall(r"\w+", text.lower()):
                h = int(hashlib.md5(word.encode()).hexdigest(), 16)
                v[h % DIM] += 1.0 if (h >> 12) % 2 else -1.0
            out.append(normalise(v))
        return out


def to_pgvector(vector: list[float]) -> str:
    return "[" + ",".join(f"{x:.6f}" for x in vector) + "]"
