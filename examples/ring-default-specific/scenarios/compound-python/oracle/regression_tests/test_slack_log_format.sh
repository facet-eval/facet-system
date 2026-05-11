#!/bin/bash
# Regression test 2: SLACK and LOG channels emit the exact format strings
# end-to-end through the CLI. Independent of refactor state because the
# CLI dispatch path is preserved across refactors.
#
# Args: $1 = workspace path, $2 = oracle dir.

set -u

WS="$1"
ORACLE="$2"
FIXTURES="$ORACLE/regression_tests/fixtures"

# log_only: build-system / error → matches Rule 1 only (EMAIL + LOG).
log_out=$(cd "$WS" && python -m notifier --events "$FIXTURES/log_only.json" 2>/dev/null)
log_exit=$?
if [[ $log_exit -ne 0 ]]; then
    echo "reg2: CLI failed on log_only.json (exit=$log_exit)" >&2
    exit 1
fi
if ! grep -qxF "LOG: build-system | error | hi" <<< "$log_out"; then
    echo "reg2: missing exact LOG line. Got:" >&2
    echo "$log_out" >&2
    exit 1
fi
if ! grep -qxF "EMAIL: build-system | error | hi" <<< "$log_out"; then
    echo "reg2: missing exact EMAIL line. Got:" >&2
    echo "$log_out" >&2
    exit 1
fi

# slack_only: deploy / info → matches Rule 2 only (SLACK).
slack_out=$(cd "$WS" && python -m notifier --events "$FIXTURES/slack_only.json" 2>/dev/null)
slack_exit=$?
if [[ $slack_exit -ne 0 ]]; then
    echo "reg2: CLI failed on slack_only.json (exit=$slack_exit)" >&2
    exit 1
fi
if ! grep -qxF "SLACK: deploy | info | ok" <<< "$slack_out"; then
    echo "reg2: missing exact SLACK line. Got:" >&2
    echo "$slack_out" >&2
    exit 1
fi

exit 0
