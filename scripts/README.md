# Sandbox capture harness (phase P3)

Catches a canary secret leaving the Daytona sandbox while a server under
audit runs. Two scripts, run in order, plus the mitmproxy addon they wire
together.

## Scripts

- **`sandbox-bootstrap.sh`** — one-time-per-sandbox setup. Installs Node 22
  from the official static tarball into `/opt` and mitmproxy via `pip`.
  Idempotent: safe to run again, it skips anything already installed. Ends
  with a `BOOTSTRAP_OK node=<version> mitmdump=<version>` line.
- **`run-under-capture.sh`** — starts mitmproxy with
  `../sandbox/canary_addon.py` loaded, points the server-under-audit's HTTP
  client stack at it, then runs the given command. On exit it tears mitmproxy
  down and prints whatever canary hits were captured.
- **`../sandbox/canary_addon.py`** — the mitmproxy addon. Scans every request
  (URL, header values, body) for a canary secret and records a hit.

## Run sequence

```bash
# once per fresh sandbox
bash scripts/sandbox-bootstrap.sh

# once per server under audit — replace the trailing command with however
# the probe launches the server, e.g. `node dist/probe.mjs`
scripts/run-under-capture.sh node dist/probe.mjs
```

`run-under-capture.sh` requires the canaries to already be in the target
command's environment (the agent seeds those, e.g. `canary-<hex>` values in
env vars the probe passes through to the server under audit) — it only
handles proxying and CA trust, not canary generation.

### What `run-under-capture.sh` exports for the target command

```bash
export HTTP_PROXY=http://127.0.0.1:8080 HTTPS_PROXY=http://127.0.0.1:8080
export NODE_EXTRA_CA_CERTS=$HOME/.mitmproxy/mitmproxy-ca-cert.pem
export NODE_OPTIONS="--use-env-proxy"
export SSL_CERT_FILE=$HOME/.mitmproxy/mitmproxy-ca-cert.pem
export REQUESTS_CA_BUNDLE=$HOME/.mitmproxy/mitmproxy-ca-cert.pem
export CANARY_HITS_FILE=/tmp/sentinel/canary_hits.jsonl
```

`NODE_OPTIONS="--use-env-proxy"` is load-bearing: Node otherwise ignores
`HTTP_PROXY`/`HTTPS_PROXY` entirely. `NODE_EXTRA_CA_CERTS` /`SSL_CERT_FILE` /
`REQUESTS_CA_BUNDLE` let Node, and any Python `requests`/`ssl`-based tooling,
trust mitmproxy's locally-generated CA instead of failing TLS verification.

## `canary_hits.jsonl` schema

One JSON object per line, written by `canary_addon.py`, one line per canary
match found in a request. This is the contract the orchestrator's
`analyze_capture` tool parses — field names and shape are pinned:

```json
{"ts": <epoch float>, "url": "<full url>", "method": "<GET|POST|...>", "match": "<the canary value>", "location": "body"|"header"|"url", "body_snippet": "<first 2000 bytes of body, utf-8 replace>"}
```

- `ts` — `time.time()` when the hit was recorded.
- `url` — the full request URL (`request.pretty_url`).
- `method` — the HTTP method of the request that carried the canary.
- `match` — the exact matched canary string (pattern: `canary-[0-9a-fA-F-]{8,36}`).
- `location` — where in the request the match was found: `"url"`, `"header"`,
  or `"body"`.
- `body_snippet` — the first 2000 bytes of the request body, decoded as UTF-8
  with `errors="replace"`. Present on every hit line regardless of
  `location`, for context.

The file's parent directory is created automatically. Default path is
`/tmp/sentinel/canary_hits.jsonl`; override with the `CANARY_HITS_FILE` env
var (both the addon and `run-under-capture.sh` honor it — set it before
invoking either if you want a non-default location).

An empty or missing hits file means no canary left the sandbox.
