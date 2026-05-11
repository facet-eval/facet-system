#!/bin/bash
# Regression test 1: multi-digit lexing + mul end-to-end.
#
# Args: $1 = workspace path, $2 = oracle dir.

set -u

WS="$1"

run() {
    local input="$1"
    cd "$WS" && echo "$input" | cabal run -v0 rpncalc 2>/dev/null
}

out=$(run "12 11 mul")
if [[ "$out" != "132" ]]; then
    echo "reg1: '12 11 mul' expected 132, got '$out'" >&2
    exit 1
fi

out=$(run "100 7 mul")
if [[ "$out" != "700" ]]; then
    echo "reg1: '100 7 mul' expected 700, got '$out'" >&2
    exit 1
fi

exit 0
