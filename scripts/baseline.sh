#!/usr/bin/env bash
# A1: re-baseline the default world (docs/STATUS.md, Roadmap, Tier A).
# 8 seeds x 10,000 ticks of the unmodified defaults (brain controller, immigration off), in parallel.
# Run it on the long-run machine (Fedora). Usage: bash scripts/baseline.sh [seeds] [ticks] [workers]
#   bash scripts/baseline.sh                # seeds 1-8, 10000 ticks, workers = cores - 1
#   bash scripts/baseline.sh 1-3 3000 2     # a quick trial
# Writes docs/experiments/baseline-<date>.txt (summary) and .json (raw). Commit both, then tell the agent.
set -euo pipefail
cd "$(dirname "$0")/.."

seeds="${1:-1-8}"
ticks="${2:-10000}"
cores="$(nproc 2>/dev/null || echo 2)"
workers="${3:-$(( cores > 1 ? cores - 1 : 1 ))}"
stamp="$(date +%Y-%m-%d)"
out="docs/experiments/baseline-${stamp}"
commit="$(git rev-parse --short HEAD)"
cmd="npm run experiment -- --compare dnaEnabled=true --seeds ${seeds} --ticks ${ticks} --workers ${workers} --json ${out}.json"

mkdir -p docs/experiments
{
  echo "# Default-world baseline (roadmap A1)"
  echo "# commit ${commit}, ${stamp}, $(uname -n), ${workers} workers"
  echo "# command: ${cmd}"
  echo "# 'dnaEnabled=true' is the default, so this is a single-arm run of the unmodified defaults."
  echo
} > "${out}.txt"

echo "Running: ${cmd}"
${cmd} 2>&1 | tee -a "${out}.txt"
echo
echo "Done. Wrote ${out}.txt and ${out}.json. Commit them and push."
