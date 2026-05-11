#!/bin/bash
# Task 1 (bug): off-by-one in record-loop bounds must be fixed.
#
# Args: $1 = workspace path (already built), $2 = oracle dir.
# - valid.tlv must dump correctly (exit 0).
# - truncated.tlv must be rejected (exit non-zero).

WS="$1"
ORACLE="$2"
FIXTURES="$ORACLE/tests/fixtures"

# valid.tlv: well-formed file, must succeed.
out=$("$WS/tlv" dump "$FIXTURES/valid.tlv" 2>/dev/null)
rc=$?
if [[ $rc -ne 0 ]]; then
    echo "task1: dump valid.tlv exited $rc (want 0)" >&2
    exit 1
fi
if ! grep -qF "INT32: 42" <<< "$out"; then
    echo "task1: valid.tlv missing 'INT32: 42'. Got:" >&2
    echo "$out" >&2
    exit 1
fi
if ! grep -qF 'STRING_UTF8: "hello"' <<< "$out"; then
    echo "task1: valid.tlv missing 'STRING_UTF8: \"hello\"'. Got:" >&2
    echo "$out" >&2
    exit 1
fi

# truncated.tlv: must be rejected (exit non-zero).
"$WS/tlv" dump "$FIXTURES/truncated.tlv" >/dev/null 2>&1
rc=$?
if [[ $rc -eq 0 ]]; then
    echo "task1: dump truncated.tlv accepted the file (exit 0); bug not fixed" >&2
    exit 1
fi

exit 0
