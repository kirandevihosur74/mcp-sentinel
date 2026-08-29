#!/usr/bin/env bash
# run-under-capture.sh — runs one server-under-audit with all its egress
# routed through mitmproxy + sandbox/canary_addon.py, so a canary secret that
# leaves the sandbox gets caught (phase P3).
#
# Usage (after scripts/sandbox-bootstrap.sh has run once in this sandbox):
#   scripts/run-under-capture.sh <command to launch the server under audit> [args...]
#
# Example:
#   scripts/run-under-capture.sh node dist/probe.mjs
#
# What it does:
#   1. Starts `mitmdump -s sandbox/canary_addon.py` in the background. This
#      also generates mitmproxy's CA at the default ~/.mitmproxy location on
#      first run.
#   2. Waits briefly for the proxy port to accept connections.
#   3. Exports the env block the server-under-audit needs to actually route
#      through the proxy and trust its CA (see the README for why each var
#      is required — NODE_OPTIONS in particular: Node silently ignores
#      HTTP_PROXY/HTTPS_PROXY unless --use-env-proxy is set).
#   4. Runs the given command in the foreground.
#   5. On exit (normal, error, or signal) tears down mitmdump and prints the
#      captured canary hits.
#
# Note: step 4 deliberately does NOT `exec` the target command. A literal
# exec would replace this shell's process image, which would prevent step 5
# from ever running — there would be no shell left to report what was
# captured once the target exits. Running it as a normal foreground child
# keeps the hits report intact while still forwarding the target's exit code.

set -euo pipefail

if [ "$#" -eq 0 ]; then
  echo "usage: $0 <command to launch the server under audit> [args...]" >&2
  exit 2
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
ADDON_PATH="${REPO_ROOT}/sandbox/canary_addon.py"

if [ ! -f "$ADDON_PATH" ]; then
  echo "run-under-capture: addon not found at ${ADDON_PATH}" >&2
  exit 1
fi

# --- make sure node/mitmdump are reachable -----------------------------------
# Picks up scripts/sandbox-bootstrap.sh's PATH additions even in a fresh
# shell, with a defensive fallback in case it ran in a different session.

if [ -f /opt/sentinel/env.sh ]; then
  # shellcheck disable=SC1091
  . /opt/sentinel/env.sh
fi
for node_dir in /opt/node-v*-linux-x64/bin; do
  [ -d "$node_dir" ] || continue
  case ":${PATH}:" in
    *":${node_dir}:"*) ;;
    *) PATH="${node_dir}:${PATH}" ;;
  esac
done
for extra_dir in "${HOME}/.local/bin" /usr/local/bin; do
  [ -d "$extra_dir" ] || continue
  case ":${PATH}:" in
    *":${extra_dir}:"*) ;;
    *) PATH="${extra_dir}:${PATH}" ;;
  esac
done
export PATH

if ! command -v mitmdump >/dev/null 2>&1; then
  echo "run-under-capture: mitmdump not on PATH. Run scripts/sandbox-bootstrap.sh first." >&2
  exit 1
fi

# --- start mitmproxy ----------------------------------------------------------

MITM_PORT=8080
MITM_LOG="/tmp/sentinel/mitmdump.log"
CA_CERT="${HOME}/.mitmproxy/mitmproxy-ca-cert.pem"
mkdir -p "$(dirname "$MITM_LOG")"

# Set (with the same default the addon uses) before the trap below, so
# cleanup can always reference it, even on an early failure exit.
export CANARY_HITS_FILE="${CANARY_HITS_FILE:-/tmp/sentinel/canary_hits.jsonl}"
mkdir -p "$(dirname "$CANARY_HITS_FILE")"

mitmdump -s "$ADDON_PATH" --listen-host 127.0.0.1 --listen-port "$MITM_PORT" \
  >"$MITM_LOG" 2>&1 &
MITM_PID=$!

cleanup() {
  local status=$?
  if kill -0 "$MITM_PID" 2>/dev/null; then
    kill "$MITM_PID" 2>/dev/null || true
    wait "$MITM_PID" 2>/dev/null || true
  fi
  echo ""
  echo "==> canary hits file: ${CANARY_HITS_FILE}"
  if [ -s "$CANARY_HITS_FILE" ]; then
    cat "$CANARY_HITS_FILE"
  else
    echo "(no canary hits captured)"
  fi
  exit "$status"
}
trap cleanup EXIT

# Wait for mitmproxy's listening socket, then for its CA cert to exist —
# both are written during its startup, before it is ready to serve traffic.
tries=0
while ! (exec 3<>"/dev/tcp/127.0.0.1/${MITM_PORT}") 2>/dev/null; do
  tries=$((tries + 1))
  if [ "$tries" -ge 40 ]; then
    echo "run-under-capture: mitmdump did not start listening on 127.0.0.1:${MITM_PORT}" >&2
    echo "---- mitmdump log ----" >&2
    cat "$MITM_LOG" >&2 || true
    exit 1
  fi
  sleep 0.25
done

tries=0
while [ ! -f "$CA_CERT" ]; do
  tries=$((tries + 1))
  if [ "$tries" -ge 40 ]; then
    echo "run-under-capture: mitmproxy CA cert not found at ${CA_CERT}" >&2
    exit 1
  fi
  sleep 0.25
done

# --- env the server-under-audit needs -----------------------------------------
# Critical: Node ignores HTTP_PROXY/HTTPS_PROXY unless NODE_OPTIONS sets
# --use-env-proxy. Verified against this sandbox's Node build.

export HTTP_PROXY="http://127.0.0.1:${MITM_PORT}"
export HTTPS_PROXY="http://127.0.0.1:${MITM_PORT}"
export NODE_EXTRA_CA_CERTS="$CA_CERT"
export NODE_OPTIONS="--use-env-proxy"
export SSL_CERT_FILE="$CA_CERT"
export REQUESTS_CA_BUNDLE="$CA_CERT"
# CANARY_HITS_FILE was already exported above, before mitmdump started.

# --- run the server under audit -----------------------------------------------

set +e
"$@"
TARGET_STATUS=$?
set -e

exit "$TARGET_STATUS"
