#!/bin/bash
# Regression test 4: CLI iterates over a multi-event JSONL fixture.
# Three events: one Rule-1-only, one no-match, one Rule-2-only.
#
# Args: $1 = workspace path, $2 = oracle dir.

set -u

WS="$1"
ORACLE="$2"
FIXTURES="$ORACLE/regression_tests/fixtures"

out=$(cd "$WS" && python -m notifier --events "$FIXTURES/multi_event.json" 2>/dev/null)
rc=$?
if [[ $rc -ne 0 ]]; then
    echo "reg4: CLI failed on multi_event.json (exit=$rc)" >&2
    exit 1
fi

# Must contain at least one of each label.
for label in "EMAIL:" "LOG:" "SLACK:"; do
    if ! grep -qF "$label" <<< "$out"; then
        echo "reg4: multi_event output missing $label" >&2
        echo "$out" >&2
        exit 1
    fi
done

# First event "a" must appear; third event "c" must appear.
if ! grep -qF '| a' <<< "$out"; then
    echo "reg4: first-event message 'a' not found" >&2
    echo "$out" >&2
    exit 1
fi
if ! grep -qF '| c' <<< "$out"; then
    echo "reg4: third-event message 'c' not found" >&2
    echo "$out" >&2
    exit 1
fi

exit 0
