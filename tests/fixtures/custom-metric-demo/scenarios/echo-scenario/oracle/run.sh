#!/bin/bash
# Oracle for the echo-scenario. Expects `pong.txt` with `pong\n`. Emits
# one task line so the evaluator records task1 pass/fail per the framework
# convention. Exit 0 only when the task passes — same contract as the
# hello-world scenario.
set -e
cd "$1"
if [[ -f pong.txt ]] && [[ "$(cat pong.txt)" == "pong" ]]; then
  echo "task1: passed"
  exit 0
fi
echo "task1: failed"
exit 1
