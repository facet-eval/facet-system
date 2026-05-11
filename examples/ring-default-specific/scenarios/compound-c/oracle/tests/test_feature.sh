#!/bin/bash
# Task 2 (feature): BOOL value type must be supported end-to-end.
#
# Args: $1 = workspace path, $2 = oracle dir.
# - append --type=bool --value=true and --value=false must succeed.
# - dump on the resulting file must contain BOOL: true and BOOL: false.
# - bool_bad_length.tlv must be rejected.

WS="$1"
ORACLE="$2"
FIXTURES="$ORACLE/tests/fixtures"
TMP=$(mktemp)
rm -f "$TMP"

cleanup() { rm -f "$TMP"; }
trap cleanup EXIT

"$WS/tlv" append "$TMP" --type=bool --value=true >/dev/null 2>&1
rc=$?
if [[ $rc -ne 0 ]]; then
    echo "task2: append --type=bool --value=true failed (exit $rc)" >&2
    exit 1
fi

"$WS/tlv" append "$TMP" --type=bool --value=false >/dev/null 2>&1
rc=$?
if [[ $rc -ne 0 ]]; then
    echo "task2: append --type=bool --value=false failed (exit $rc)" >&2
    exit 1
fi

out=$("$WS/tlv" dump "$TMP" 2>/dev/null)
rc=$?
if [[ $rc -ne 0 ]]; then
    echo "task2: dump on round-trip file failed (exit $rc)" >&2
    exit 1
fi
if ! grep -qF "BOOL: true" <<< "$out"; then
    echo "task2: dump missing 'BOOL: true'. Got:" >&2
    echo "$out" >&2
    exit 1
fi
if ! grep -qF "BOOL: false" <<< "$out"; then
    echo "task2: dump missing 'BOOL: false'. Got:" >&2
    echo "$out" >&2
    exit 1
fi

# bool_bad_length.tlv: BOOL with length=2 must be rejected.
"$WS/tlv" dump "$FIXTURES/bool_bad_length.tlv" >/dev/null 2>&1
rc=$?
if [[ $rc -eq 0 ]]; then
    echo "task2: bool_bad_length.tlv was accepted; BOOL length validation missing" >&2
    exit 1
fi

exit 0
