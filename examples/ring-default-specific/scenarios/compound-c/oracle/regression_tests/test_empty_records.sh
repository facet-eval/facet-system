#!/bin/bash
# Regression test 3: header-only file (no records) dumps cleanly.
#
# Args: $1 = workspace path, $2 = oracle dir.

WS="$1"
ORACLE="$2"
FIXTURES="$ORACLE/regression_tests/fixtures"

out=$("$WS/tlv" dump "$FIXTURES/header_only.tlv" 2>/dev/null)
rc=$?
if [[ $rc -ne 0 ]]; then
    echo "reg3: dump header_only.tlv failed (exit $rc)" >&2
    exit 1
fi
if [[ -n "$out" ]]; then
    echo "reg3: expected empty stdout, got:" >&2
    echo "$out" >&2
    exit 1
fi

exit 0
