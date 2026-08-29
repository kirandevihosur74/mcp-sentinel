# Sandbox capture harness (phase P3)

Catches a canary secret leaving the Daytona sandbox while a server under
audit runs. Two scripts, run in order, plus the mitmproxy addon they wire
together.

## Scripts

- **`sandbox-bootstrap.sh`** — one-time-per-sandbox setup. Installs Node
  **22.23.2** from the official static tarball into `/opt` and mitmproxy via
  `pip`. The version is pinned deliberately, not just "latest 22": Node's
  `--use-env-proxy` flag (see below) needs 22.21.0+, and 22.23.2 is the
  newest 22.x LTS as of writing. Idempotent: safe to run again, it skips
  anything already installed. Ends with a
  `BOOTSTRAP_OK node=<version> mitmdump=<version>` line.
- **`run-under-capture.sh`** — picks a free per-run proxy port, starts
  mitmproxy with `../sandbox/canary_addon.py` loaded on it, confirms (via
  `/proc`, not just "a port answered") that its own mitmdump process is the
  one actually bound before trusting it, points the server-under-audit's
  HTTP client stack at it, then runs the given command in its own process
  group. The hits file and mitmdump's log are truncated at the start of
  every run, so a clean run never reports a previous run's leaks. An
  INT/TERM/HUP sent to the wrapper is forwarded to the target's whole
  process group (waited on, escalating to `KILL` if ignored) before
  mitmproxy is torn down — a killed wrapper can't leave the audited server
  running unobserved. On exit it prints whatever canary hits were captured.
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
export HTTP_PROXY=http://127.0.0.1:<port> HTTPS_PROXY=http://127.0.0.1:<port>
export NODE_EXTRA_CA_CERTS=$HOME/.mitmproxy/mitmproxy-ca-cert.pem
export NODE_OPTIONS="--use-env-proxy"
export SSL_CERT_FILE=$HOME/.mitmproxy/mitmproxy-ca-cert.pem
export REQUESTS_CA_BUNDLE=$HOME/.mitmproxy/mitmproxy-ca-cert.pem
export CANARY_HITS_FILE=/tmp/sentinel/canary_hits.jsonl
```

`<port>` is picked per run (an OS-assigned free port; falls back to `8080`
only if that allocation itself fails) — this env block is only exported
after the script has proven, by checking which process actually holds the
listening socket, that its own mitmdump is the one bound to it. That
avoids a stale or unrelated process on a fixed port being mistaken for
readiness.

`NODE_OPTIONS="--use-env-proxy"` is load-bearing: Node otherwise ignores
`HTTP_PROXY`/`HTTPS_PROXY` entirely, and the flag itself only exists from
Node 22.21.0 on — see the version note on `sandbox-bootstrap.sh` above.
`NODE_EXTRA_CA_CERTS` /`SSL_CERT_FILE` /`REQUESTS_CA_BUNDLE` let Node, and
any Python `requests`/`ssl`-based tooling, trust mitmproxy's
locally-generated CA instead of failing TLS verification.

## Limitations

This harness only sees traffic that actually goes through the
`HTTP_PROXY`/`HTTPS_PROXY` env vars above. A server under audit that opens
a raw TCP or UDP socket directly, or that uses an HTTP client which ignores
those env vars, exfiltrates outside this capture entirely. That's a real
gap — it's not attempting full egress control, only HTTP(S) interception.

It's an acceptable gap for this phase because HTTP(S) is both the decoy's
exfil path and the overwhelmingly common one for a real malicious MCP
server (calling home to a webhook/API). Closing the rest is a sandbox
network-policy problem, not something a per-run wrapper script should take
on: the production answer is enforcing it at the Daytona sandbox level —
`domainAllowList` / `networkBlockAll`, or an iptables `REDIRECT` of all
outbound TCP to the proxy port so nothing can route around it.

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
