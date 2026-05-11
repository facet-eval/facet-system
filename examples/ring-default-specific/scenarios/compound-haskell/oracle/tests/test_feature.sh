#!/bin/bash
# Task 2 (feature): mod operator recognized end-to-end.
#
# Args: $1 = workspace path, $2 = oracle dir.

set -u

WS="$1"

run() {
    local input="$1"
    cd "$WS" && echo "$input" | cabal run -v0 rpncalc 2>/dev/null
}

out=$(run "7 3 mod")
if [[ "$out" != "1" ]]; then
    echo "task2: '7 3 mod' expected 1, got '$out'" >&2
    exit 1
fi

out=$(run "0 5 mod")
if [[ "$out" != "0" ]]; then
    echo "task2: '0 5 mod' expected 0, got '$out'" >&2
    exit 1
fi

exit 0
