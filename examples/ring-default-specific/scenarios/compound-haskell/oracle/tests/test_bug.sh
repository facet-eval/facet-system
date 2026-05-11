#!/bin/bash
# Task 1 (bug): operands must apply in correct order.
#
# Args: $1 = workspace path, $2 = oracle dir.

set -u

WS="$1"

run() {
    local input="$1"
    cd "$WS" && echo "$input" | cabal run -v0 rpncalc 2>/dev/null
}

# Non-commutative: 5 2 sub must give 3 (not -3).
out=$(run "5 2 sub")
if [[ "$out" != "3" ]]; then
    echo "task1: '5 2 sub' expected 3, got '$out'" >&2
    exit 1
fi

# Sanity: commutative 5 2 add still gives 7.
out=$(run "5 2 add")
if [[ "$out" != "7" ]]; then
    echo "task1: '5 2 add' expected 7, got '$out'" >&2
    exit 1
fi

exit 0
