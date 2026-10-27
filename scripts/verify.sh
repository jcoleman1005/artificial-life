#!/usr/bin/env bash
# Runs check, tests and build; prints one line per step, or the tail of the failing step.
cd "$(dirname "$0")/.." || exit 1
run() {
  local name=$1; shift
  local out; out=$(mktemp)
  if "$@" >"$out" 2>&1; then
    echo "ok   $name"; rm -f "$out"
  else
    echo "FAIL $name"; tail -n 40 "$out"; rm -f "$out"; exit 1
  fi
}
run check npx tsc -b
run test npx vitest run --reporter=dot --testTimeout=60000
run build npm run build
