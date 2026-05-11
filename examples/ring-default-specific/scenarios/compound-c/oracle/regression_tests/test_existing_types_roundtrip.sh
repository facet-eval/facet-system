#!/bin/bash
# Regression test 2: append + dump round-trip for INT32 and STRING_UTF8.
#
# Args: $1 = workspace path, $2 = oracle dir.

WS="$1"

TMP=$(mktemp)
rm -f "$TMP"
cleanup() { rm -f "$TMP"; }
trap cleanup EXIT

"$WS/tlv" append "$TMP" --type=int32 --value=42 >/dev/null 2>&1
if [[ $? -ne 0 ]]; then
    echo "reg2: append int32 failed" >&2
    exit 1
fi
"$WS/tlv" append "$TMP" --type=string --value=hello >/dev/null 2>&1
if [[ $? -ne 0 ]]; then
    echo "reg2: append string failed" >&2
    exit 1
fi

out=$("$WS/tlv" dump "$TMP" 2>/dev/null)
rc=$?
if [[ $rc -ne 0 ]]; then
    echo "reg2: dump after round-trip failed (exit $rc)" >&2
    exit 1
fi

if ! grep -qxF "INT32: 42" <<< "$out"; then
    echo "reg2: missing exact 'INT32: 42'. Got:" >&2
    echo "$out" >&2
    exit 1
fi
if ! grep -qxF 'STRING_UTF8: "hello"' <<< "$out"; then
    echo "reg2: missing exact 'STRING_UTF8: \"hello\"'. Got:" >&2
    echo "$out" >&2
    exit 1
fi

exit 0
