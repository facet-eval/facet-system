#!/bin/bash
# Regression test 2: single-number program (number-push + eval).
#
# Args: $1 = workspace path, $2 = oracle dir.

set -u

WS="$1"

out=$(cd "$WS" && echo "42" | cabal run -v0 rpncalc 2>/dev/null)
if [[ "$out" != "42" ]]; then
    echo "reg2: '42' expected 42, got '$out'" >&2
    exit 1
fi

exit 0
