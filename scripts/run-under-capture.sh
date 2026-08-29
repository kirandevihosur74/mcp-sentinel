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
#   1. Picks a free per-run proxy port and starts
#      `mitmdump -s sandbox/canary_addon.py` on it in the background. This
#      also generates mitmproxy's CA at the default ~/.mitmproxy location on
#      first run.
#   2. Waits until THIS mitmdump process (not just "something" on the port)
#      is confirmed to own the listening socket, and until its CA cert
#      exists.
#   3. Exports the env block the server-under-audit needs to actually route
#      through the proxy and trust its CA (see scripts/README.md for why
#      each var is required — NODE_OPTIONS in particular: Node silently
#      ignores HTTP_PROXY/HTTPS_PROXY unless --use-env-proxy is set. That
#      flag requires Node 22.21.0+; scripts/sandbox-bootstrap.sh pins a
#      newer version specifically so this works).
#   4. Runs the given command in the foreground, in its own process group.
#   5. On exit — normal, error, or an INT/TERM/HUP delivered to this
#      wrapper — stops the target (and anything it spawned), tears down
#      mitmdump, and prints the captured canary hits.
#
# Known limitation (by design, not a bug — see scripts/README.md): this only
# captures traffic that actually goes through the HTTP_PROXY/HTTPS_PROXY env
# vars. A raw TCP/UDP connection, or a client that ignores those vars, is
# invisible to this harness. That covers the decoy's exfil path and the
# common real-world one; closing the rest is a sandbox-network-policy
# concern (Daytona's domainAllowList / networkBlockAll, or an iptables
# REDIRECT of all outbound TCP to the proxy port), not something this
# per-run wrapper script should try to take on.
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

# --- helpers -------------------------------------------------------------
# All defined up front, before anything is started or any trap is armed, so
# a signal can never land on a handler that calls an as-yet-undefined
# function.

find_free_port() {
  # Ask the OS for an ephemeral port by binding to it, reading it back, then
  # releasing it. There's a small window where another process could grab
  # the same port before mitmdump does; proxy_owns_port() below is what
  # actually proves mitmdump won that race, not this allocation by itself.
  python3 - <<'PY' 2>/dev/null
import socket
s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
s.bind(("127.0.0.1", 0))
print(s.getsockname()[1])
s.close()
PY
}

proxy_owns_port() {
  # True only if PID $1 holds the fd for the LISTEN socket on port $2, read
  # straight out of /proc — no dependency on lsof/ss/fuser being installed.
  local pid="$1" port="$2" hex_port inode fd
  hex_port="$(printf '%04X' "$port")"
  inode="$(awk -v p=":${hex_port}" '$2 ~ p && $4 == "0A" { print $10; exit }' /proc/net/tcp 2>/dev/null)"
  [ -n "$inode" ] || return 1
  for fd in /proc/"${pid}"/fd/*; do
    [ -e "$fd" ] || continue
    [ "$(readlink "$fd" 2>/dev/null)" = "socket:[${inode}]" ] && return 0
  done
  return 1
}

stop_target() {
  # Signal the target's whole process group (negative PID), not just the
  # one PID we launched — it may have spawned children of its own. Escalate
  # to KILL if it ignores the polite signal.
  local sig="$1" waited=0
  kill -s "$sig" -- "-${TARGET_PID}" 2>/dev/null || true
  while kill -0 "$TARGET_PID" 2>/dev/null; do
    if [ "$waited" -ge 50 ]; then
      kill -s KILL -- "-${TARGET_PID}" 2>/dev/null || true
      break
    fi
    waited=$((waited + 1))
    sleep 0.1
  done
  wait "$TARGET_PID" 2>/dev/null || true
}

cleanup() {
  local status=$?
  if [ -n "$TARGET_PID" ] && kill -0 "$TARGET_PID" 2>/dev/null; then
    stop_target TERM
  fi
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

on_signal() {
  # Forward to the target's process group and wait for it to actually go
  # down before letting the EXIT trap (cleanup, above) tear mitmdump down
  # and report hits. Without this, killing the wrapper could leave the
  # audited server running with the proxy already gone underneath it.
  local sig="$1" code="$2"
  echo "" >&2
  echo "run-under-capture: received ${sig}, stopping the audited server..." >&2
  if [ -n "$TARGET_PID" ] && kill -0 "$TARGET_PID" 2>/dev/null; then
    stop_target "$sig"
  fi
  exit "$code"
}

# --- pick a port and prep run-scoped files -----------------------------------

MITM_PORT="$(find_free_port || true)"
case "$MITM_PORT" in
  '' | *[!0-9]*) MITM_PORT=8080 ;;  # find_free_port failed; fall back to the documented default
esac

MITM_LOG="/tmp/sentinel/mitmdump.log"
CA_CERT="${HOME}/.mitmproxy/mitmproxy-ca-cert.pem"
mkdir -p "$(dirname "$MITM_LOG")"
: > "$MITM_LOG"  # fresh per run: a leftover log from a previous run must not confuse anything reading it

export CANARY_HITS_FILE="${CANARY_HITS_FILE:-/tmp/sentinel/canary_hits.jsonl}"
mkdir -p "$(dirname "$CANARY_HITS_FILE")"
: > "$CANARY_HITS_FILE"  # fresh per run: a clean run must never report a previous run's leaks

# --- start mitmproxy ----------------------------------------------------------

mitmdump -s "$ADDON_PATH" --listen-host 127.0.0.1 --listen-port "$MITM_PORT" \
  >"$MITM_LOG" 2>&1 &
MITM_PID=$!
TARGET_PID=""

trap cleanup EXIT
trap 'on_signal TERM 143' TERM
trap 'on_signal INT 130' INT
trap 'on_signal HUP 129' HUP

# Wait until mitmdump is both alive and provably the process bound to
# MITM_PORT (not some unrelated process that happened to be listening
# there already), then wait for its CA cert to exist.
tries=0
mitm_ready=0
while [ "$tries" -lt 60 ]; do
  if ! kill -0 "$MITM_PID" 2>/dev/null; then
    echo "run-under-capture: mitmdump (pid ${MITM_PID}) exited before becoming ready" >&2
    echo "---- mitmdump log ----" >&2
    cat "$MITM_LOG" >&2 || true
    exit 1
  fi
  if (exec 3<>"/dev/tcp/127.0.0.1/${MITM_PORT}") 2>/dev/null && proxy_owns_port "$MITM_PID" "$MITM_PORT"; then
    mitm_ready=1
    break
  fi
  tries=$((tries + 1))
  sleep 0.25
done
if [ "$mitm_ready" -ne 1 ]; then
  echo "run-under-capture: could not confirm mitmdump (pid ${MITM_PID}) is bound to 127.0.0.1:${MITM_PORT}" >&2
  echo "---- mitmdump log ----" >&2
  cat "$MITM_LOG" >&2 || true
  exit 1
fi

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
# --use-env-proxy (needs Node 22.21.0+ — see sandbox-bootstrap.sh).

export HTTP_PROXY="http://127.0.0.1:${MITM_PORT}"
export HTTPS_PROXY="http://127.0.0.1:${MITM_PORT}"
export NODE_EXTRA_CA_CERTS="$CA_CERT"
export NODE_OPTIONS="--use-env-proxy"
export SSL_CERT_FILE="$CA_CERT"
export REQUESTS_CA_BUNDLE="$CA_CERT"
# CANARY_HITS_FILE was already exported above, before mitmdump started.

# --- run the server under audit, in its own process group -------------------
# A dedicated process group (via job control's "set -m", not just an
# ordinary background job) is what lets stop_target() above reach the whole
# tree the target spawns, not just the one PID we launched.

set -m
"$@" &
TARGET_PID=$!
set +m

set +e
wait "$TARGET_PID"
TARGET_STATUS=$?
set -e
TARGET_PID=""  # already reaped; cleanup() must not try to signal it again

exit "$TARGET_STATUS"
