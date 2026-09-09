#!/usr/bin/env bash
# Idempotent dependency setup for the Claude Agent SDK demos monorepo.
# Safe to re-run: each step is a no-op or a refresh when already satisfied.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

log() { echo "=== [install] $* ==="; }
fail=0

# --- Toolchains -------------------------------------------------------------
# Bun (required by email-agent) and uv (used by research-agent) are not part of
# the base image. Install into $HOME so they survive into the build snapshot.
export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
export PATH="$HOME/.local/bin:$BUN_INSTALL/bin:$PATH"

if ! command -v bun >/dev/null 2>&1; then
  log "installing bun"
  curl -fsSL https://bun.sh/install | bash
fi
if ! command -v uv >/dev/null 2>&1; then
  log "installing uv"
  curl -LsSf https://astral.sh/uv/install.sh | sh
fi

log "bun $(bun --version 2>/dev/null || echo MISSING) | uv $(uv --version 2>/dev/null || echo MISSING) | node $(node --version) | python $(python3 --version)"

# --- Node/Bun demos ---------------------------------------------------------
# hello-world pins zod@4 while its SDK peer-depends on zod@3, so it needs
# --legacy-peer-deps.
npm_install() {
  local dir="$1"; shift
  log "npm install: $dir"
  ( cd "$dir" && npm install --no-audit --no-fund "$@" ) || { echo "FAILED: $dir"; fail=1; }
}

npm_install hello-world --legacy-peer-deps
npm_install hello-world-v2
npm_install resume-generator
npm_install ask-user-question-previews
npm_install excel-demo

# simple-chatapp's committed lockfile pins an internal registry that is not
# reachable here, so resolve fresh from the public npm registry.
log "npm install: simple-chatapp (public registry)"
( cd simple-chatapp && npm install --no-audit --no-fund --legacy-peer-deps \
    --no-package-lock --registry https://registry.npmjs.org ) \
  || { echo "FAILED: simple-chatapp"; fail=1; }

log "bun install: email-agent"
( cd email-agent && bun install ) || { echo "FAILED: email-agent"; fail=1; }

# --- Python demo ------------------------------------------------------------
log "uv sync: research-agent"
( cd research-agent && uv sync ) || { echo "FAILED: research-agent"; fail=1; }

# --- Runtime working directories -------------------------------------------
# hello-world and resume-generator point the agent's cwd at agent/custom_scripts,
# which does not exist in a fresh checkout. Without it the SDK fails to spawn
# the Claude CLI subprocess ("spawn node ENOENT").
log "creating agent working directories"
mkdir -p hello-world/agent/custom_scripts resume-generator/agent/custom_scripts

if [ "$fail" -ne 0 ]; then
  log "one or more demos failed to install"
  exit 1
fi
log "all demos installed"
