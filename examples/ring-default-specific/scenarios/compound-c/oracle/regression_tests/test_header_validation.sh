#!/bin/bash
# Regression test 1: header validation rejects bad magic and bad version.
#
# Args: $1 = workspace path, $2 = oracle dir.

WS="$1"
ORACLE="$2"
FIXTURES="$ORACLE/regression_tests/fixtures"

"$WS/tlv" dump "$FIXTURES/bad_magic.tlv" >/dev/null 2>&1
if [[ $? -eq 0 ]]; then
    echo "reg1: bad_magic.tlv was accepted" >&2
    exit 1
fi

"$WS/tlv" dump "$FIXTURES/bad_version.tlv" >/dev/null 2>&1
if [[ $? -eq 0 ]]; then
    echo "reg1: bad_version.tlv was accepted" >&2
    exit 1
fi

exit 0
