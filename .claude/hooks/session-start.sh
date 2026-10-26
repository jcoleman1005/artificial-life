#!/usr/bin/env bash
# Install dependencies for cloud sessions, only if missing.
cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}" || exit 0
[ -d node_modules ] || npm ci --no-audit --no-fund --silent >/dev/null 2>&1
exit 0
