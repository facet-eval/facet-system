#!/bin/bash
# Task 1 (bug): Router must dispatch every matching rule.
#
# Args: $1 = workspace path (the agent's repo state), $2 = oracle dir
#       (this file's parent's parent, i.e. the scenario's oracle/).
#
# Exits 0 iff both fixtures behave per the README contract.

set -u

WS="$1"
ORACLE="$2"
FIXTURES="$ORACLE/tests/fixtures"

# Run the CLI and capture stdout.
multi_out=$(cd "$WS" && python -m notifier --events "$FIXTURES/multi_match.json" 2>/dev/null)
multi_exit=$?
if [[ $multi_exit -ne 0 ]]; then
    echo "task1: CLI failed on multi_match.json (exit=$multi_exit)" >&2
    exit 1
fi

# Multi-match: critical/api triggers Rule 1 (EMAIL+LOG) AND Rule 2 (SLACK).
# All three labels must be present.
for label in "EMAIL:" "LOG:" "SLACK:"; do
    if ! grep -qF "$label" <<< "$multi_out"; then
        echo "task1: multi_match.json missing label $label" >&2
        echo "stdout was:" >&2
        echo "$multi_out" >&2
        exit 1
    fi
done

single_out=$(cd "$WS" && python -m notifier --events "$FIXTURES/single_match.json" 2>/dev/null)
single_exit=$?
if [[ $single_exit -ne 0 ]]; then
    echo "task1: CLI failed on single_match.json (exit=$single_exit)" >&2
    exit 1
fi

# Single-match: deploy/info triggers only Rule 2 (SLACK).
if ! grep -qF "SLACK:" <<< "$single_out"; then
    echo "task1: single_match.json missing SLACK:" >&2
    echo "stdout was:" >&2
    echo "$single_out" >&2
    exit 1
fi
if grep -qF "EMAIL:" <<< "$single_out"; then
    echo "task1: single_match.json should not produce EMAIL:" >&2
    exit 1
fi
if grep -qF "LOG:" <<< "$single_out"; then
    echo "task1: single_match.json should not produce LOG:" >&2
    exit 1
fi

exit 0
