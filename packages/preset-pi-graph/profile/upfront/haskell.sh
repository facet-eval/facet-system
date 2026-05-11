#!/bin/bash
# Upfront-context script for the profile-graph × compound-haskell cell.
# Replaces the framework-side `renderGraphmodCabalPlan` (Phase 5).
#
# Reads the workspace path from $1 (the runner cd's here before invoking
# this script). Emits a Markdown-friendly stdout that the runner wraps in
# a fenced block under the YAML-declared header.
#
# Exit code 0 = success. Non-zero aborts the run with UpfrontContextError.

set -euo pipefail

cd "${1:-$PWD}"

# Collect Haskell sources under the conventional dirs.
mapfile -t SOURCES < <(
  find src app -name '*.hs' -not -path '*/dist-newstyle/*' -not -path '*/.stack-work/*' 2>/dev/null \
    | sort
)

if [ "${#SOURCES[@]}" -eq 0 ]; then
  echo "No Haskell sources found under src/ or app/ in workspace ${PWD}" >&2
  exit 1
fi

cabal v2-build --dry-run all >/dev/null

echo 'Module dependency graph (`graphmod --no-cluster`):'
echo
echo '```'
graphmod --no-cluster "${SOURCES[@]}"
echo '```'
echo
echo 'Package wiring (`cabal-plan info`):'
echo
echo '```'
cabal-plan info
echo '```'
