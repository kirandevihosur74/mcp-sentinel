#!/usr/bin/env bash
# sandbox-bootstrap.sh — one-time setup for the Daytona sandbox that will host
# a server under audit plus the mitmproxy capture harness (phase P3).
#
# Verified sandbox facts this script relies on: python3 3.13 + pip 26.2.1 +
# curl are already present; node and strace are NOT. So this script installs
# a static Node 22 build (the server-under-audit needs it) and mitmproxy (the
# capture harness in scripts/run-under-capture.sh needs it). It is safe to
# re-run: every step checks whether its target is already in place first.
#
# Run once per fresh sandbox, before scripts/run-under-capture.sh:
#   bash scripts/sandbox-bootstrap.sh

set -euo pipefail

NODE_VERSION="22.23.2"
NODE_DIST="node-v${NODE_VERSION}-linux-x64"
NODE_INSTALL_ROOT="/opt"
NODE_DIST_DIR="${NODE_INSTALL_ROOT}/${NODE_DIST}"
NODE_BIN_DIR="${NODE_DIST_DIR}/bin"

# Where run-under-capture.sh (possibly a fresh shell in the same sandbox)
# picks up the PATH additions this script makes.
SENTINEL_DIR="/opt/sentinel"
ENV_FILE="${SENTINEL_DIR}/env.sh"

log() { echo "[sandbox-bootstrap] $*"; }

add_path_entry() {
  # Prepend $1 to PATH for this process, and persist it in ENV_FILE so a
  # later script sourcing ENV_FILE picks it up too. Idempotent either way.
  local dir="$1"
  case ":${PATH}:" in
    *":${dir}:"*) ;;
    *) PATH="${dir}:${PATH}" ;;
  esac
  export PATH
  mkdir -p "$SENTINEL_DIR"
  touch "$ENV_FILE"
  grep -qF "$dir" "$ENV_FILE" || printf 'export PATH="%s:$PATH"\n' "$dir" >> "$ENV_FILE"
}

# --- (a) Node 22, from the official static tarball --------------------------

if command -v node >/dev/null 2>&1 && [ "$(node --version)" = "v${NODE_VERSION}" ]; then
  log "node v${NODE_VERSION} already on PATH, skipping install."
elif [ -x "${NODE_BIN_DIR}/node" ]; then
  log "node v${NODE_VERSION} already extracted at ${NODE_DIST_DIR}, skipping download."
else
  log "installing node v${NODE_VERSION} from the official static tarball..."
  mkdir -p "$NODE_INSTALL_ROOT"
  curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/${NODE_DIST}.tar.xz" \
    | tar -xJ -C "$NODE_INSTALL_ROOT"
fi

add_path_entry "$NODE_BIN_DIR"

# --- (b) mitmproxy, via pip ---------------------------------------------------

if command -v mitmdump >/dev/null 2>&1; then
  log "mitmdump already on PATH, skipping install."
else
  log "installing mitmproxy via pip..."
  PIP_ERR="$(mktemp -t sentinel-pip-install.XXXXXX)"
  if ! python3 -m pip install --quiet mitmproxy 2>"$PIP_ERR"; then
    if grep -qi "externally-managed-environment" "$PIP_ERR"; then
      # Debian/Ubuntu-style PEP 668 guard: this sandbox's system Python
      # refuses an unscoped install. The sandbox is disposable, so override.
      log "pip reports an externally-managed environment, retrying with --break-system-packages..."
      python3 -m pip install --quiet --break-system-packages mitmproxy
    else
      log "system-wide pip install failed, retrying with --user..."
      python3 -m pip install --quiet --user mitmproxy
    fi
  fi
  rm -f "$PIP_ERR"
fi

# mitmdump's entry point may have landed in a directory that isn't on PATH
# yet (a --user install, or a scripts dir the system python doesn't expose
# by default). Search the usual pip install locations before giving up.
if ! command -v mitmdump >/dev/null 2>&1; then
  USER_BASE="$(python3 -m site --user-base 2>/dev/null || true)"
  SCRIPTS_DIR="$(python3 -c 'import sysconfig; print(sysconfig.get_path("scripts"))' 2>/dev/null || true)"
  for candidate in "${USER_BASE}/bin" "$SCRIPTS_DIR"; do
    if [ -n "$candidate" ] && [ -x "${candidate}/mitmdump" ]; then
      add_path_entry "$candidate"
      break
    fi
  done
fi

# --- (c) verify and report ---------------------------------------------------

if ! command -v node >/dev/null 2>&1; then
  echo "[sandbox-bootstrap] FATAL: node not found on PATH after install." >&2
  exit 1
fi
if ! command -v mitmdump >/dev/null 2>&1; then
  echo "[sandbox-bootstrap] FATAL: mitmdump not found on PATH after install." >&2
  exit 1
fi

echo "BOOTSTRAP_OK node=$(node --version) mitmdump=$(mitmdump --version | head -n1)"
