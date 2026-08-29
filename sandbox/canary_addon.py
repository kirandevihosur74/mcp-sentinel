# canary_addon.py — mitmproxy addon for phase P3's network-capture harness.
#
# Loaded by scripts/run-under-capture.sh via `mitmdump -s canary_addon.py`.
# Every HTTP(S) request that flows through the proxy is searched — URL, every
# header value, and the request body — for the canary pattern the agent seeds
# into a probed server's environment (canary-<hex>, see sentinel-mcp's
# make_canaries). Each match is appended as one JSON line to CANARY_HITS_FILE.
# That file's line schema is a pinned contract: sentinel-mcp's analyze_capture
# tool parses it, so do not change the field names or shape without updating
# both sides. This addon only records evidence — it never judges.
#
# One JSON line per match, exactly this shape:
#   {"ts": <epoch float>, "url": "<full url>", "method": "<GET|POST|...>",
#    "match": "<the canary value>", "location": "body"|"header"|"url",
#    "body_snippet": "<first 2000 bytes of body, utf-8 replace>"}

import json
import os
import re
import time
from pathlib import Path

from mitmproxy import ctx
from mitmproxy.http import HTTPFlow

CANARY_PATTERN = re.compile(r"canary-[0-9a-fA-F-]{8,36}")
DEFAULT_HITS_FILE = "/tmp/sentinel/canary_hits.jsonl"
BODY_SNIPPET_BYTES = 2000


def _hits_file() -> Path:
    return Path(os.environ.get("CANARY_HITS_FILE") or DEFAULT_HITS_FILE)


def _request_body_bytes(flow: HTTPFlow) -> bytes:
    """Best-effort raw body bytes. Never raises — empty/binary/missing bodies
    all fall through to b""."""
    req = flow.request
    try:
        content = req.content  # decompresses gzip/deflate when present
    except Exception:
        content = None
    if content is None:
        try:
            content = req.raw_content
        except Exception:
            content = None
    return content or b""


def _record_hit(url: str, method: str, match: str, location: str, body_snippet: str) -> None:
    hits_file = _hits_file()
    hits_file.parent.mkdir(parents=True, exist_ok=True)
    record = {
        "ts": time.time(),
        "url": url,
        "method": method,
        "match": match,
        "location": location,
        "body_snippet": body_snippet,
    }
    with hits_file.open("a", encoding="utf-8") as f:
        f.write(json.dumps(record) + "\n")
    ctx.log.alert(f"CANARY LEAK: {match} in {location} of {method} {url}")


def request(flow: HTTPFlow) -> None:
    req = flow.request
    url = req.pretty_url
    method = req.method

    body_bytes = _request_body_bytes(flow)
    body_text = body_bytes.decode("utf-8", errors="replace")
    body_snippet = body_bytes[:BODY_SNIPPET_BYTES].decode("utf-8", errors="replace")

    for m in CANARY_PATTERN.finditer(url):
        _record_hit(url, method, m.group(0), "url", body_snippet)

    for _name, value in req.headers.items(multi=True):
        for m in CANARY_PATTERN.finditer(value):
            _record_hit(url, method, m.group(0), "header", body_snippet)

    for m in CANARY_PATTERN.finditer(body_text):
        _record_hit(url, method, m.group(0), "body", body_snippet)
