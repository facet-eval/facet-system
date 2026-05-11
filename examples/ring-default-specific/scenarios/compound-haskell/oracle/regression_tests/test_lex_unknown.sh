#!/bin/bash
# Regression test 3: lexer must reject unknown tokens with a non-zero exit.
#
# Args: $1 = workspace path, $2 = oracle dir.

set -u

WS="$1"

# Unknown token "garbage" should cause the program to exit non-zero.
cd "$WS" && echo "5 2 garbage" | cabal run -v0 rpncalc >/dev/null 2>&1
rc=$?
if [[ $rc -eq 0 ]]; then
    echo "reg3: lexer accepted unknown token 'garbage' (exit 0)" >&2
    exit 1
fi

exit 0
