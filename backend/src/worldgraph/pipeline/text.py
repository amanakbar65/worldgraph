"""Small text helpers: clean headlines, one-sentence snippets, word limits."""

from __future__ import annotations

import hashlib
import html
import re
from urllib.parse import urlsplit

from worldgraph.geo.gazetteer import slugify

_TAGS = re.compile(r"<[^>]+>")
_SPACE = re.compile(r"\s+")
# " - Reuters", " | Business Standard", " – BBC News" at the end of a title.
_SITE_SUFFIX = re.compile(r"\s+[|\-–—]\s+[^|\-–—]{2,40}$")
_SENTENCE_END = re.compile(r"(?<=[.!?])\s+(?=[A-Z0-9\"“'‘(])")


def clean(text: str | None) -> str:
    if not text:
        return ""
    text = html.unescape(_TAGS.sub(" ", text))
    return _SPACE.sub(" ", text).strip()


def clean_title(title: str | None, source_name: str | None = None) -> str:
    text = clean(title)
    # Strip a trailing site name, but never the whole title.
    stripped = _SITE_SUFFIX.sub("", text)
    if len(stripped.split()) >= 4:
        text = stripped
    if source_name and text.lower().endswith(source_name.lower()):
        text = text[: -len(source_name)].rstrip(" |-–—:")
    return text


def first_sentence(text: str | None, limit: int = 300) -> str | None:
    """At most one sentence and `limit` characters (we never keep more)."""
    body = re.sub(r"https?://\S+", " ", clean(text)).strip()
    if not body:
        return None
    sentence = _SENTENCE_END.split(body, maxsplit=1)[0]
    if len(sentence) > limit:
        cut = sentence[: limit - 1].rsplit(" ", 1)[0]
        sentence = cut.rstrip(",;:") + "…"
    return sentence


def limit_words(text: str, n: int) -> str:
    words = text.split()
    return text if len(words) <= n else " ".join(words[:n]) + "…"


def domain(url: str) -> str:
    host = urlsplit(url).hostname or ""
    return host.removeprefix("www.").removeprefix("m.").removeprefix("amp.")


def story_id(title: str, seed: str) -> str:
    """story:<first words>-<short hash>: readable and stable for a given seed."""
    words = slugify(" ".join(title.split()[:6]))[:48].strip("-") or "story"
    digest = hashlib.sha1(seed.encode()).hexdigest()[:6]
    return f"story:{words}-{digest}"
