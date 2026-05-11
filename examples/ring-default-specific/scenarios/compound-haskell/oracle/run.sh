#!/bin/bash
# Oracle entry point for compound-haskell.
# Args: $1 = workspace path (the agent's repo state).
#
# Behavior:
#   - Builds the workspace via `cabal build` (full build = exhaustiveness
#     for the agent's edits).
#   - Runs three task tests; prints "[taskN] PASS|FAIL" lines.
#   - Compiles + runs TestRefactor.hs against the library for task 3.
#   - Runs three regression tests; prints "[regN] PASS|FAIL" lines.
#   - Exit 0 iff all three task tests pass.

WS="$1"

if [[ -z "${WS:-}" || ! -d "$WS" ]]; then
    echo "oracle: missing or invalid workspace path: ${WS:-<unset>}" >&2
    exit 2
fi

if ! command -v cabal >/dev/null 2>&1; then
    echo "oracle: cabal not found on PATH" >&2
    exit 2
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Build the workspace. A failed build cascades into 0/3 task tests
# (matches the design's documented Haskell cascade behavior).
build_log=$(cd "$WS" && cabal build all 2>&1)
build_rc=$?
if [[ $build_rc -ne 0 ]]; then
    echo "oracle: cabal build failed (exit=$build_rc)" >&2
    echo "$build_log" >&2 | head -c 4000
    echo "[task1] FAIL"
    echo "[task2] FAIL"
    echo "[task3] FAIL"
    exit 1
fi

run_task() {
    local label="$1"
    shift
    local out
    out=$("$@" 2>&1)
    local rc=$?
    if [[ $rc -eq 0 ]]; then
        echo "[$label] PASS"
        return 0
    fi
    echo "[$label] FAIL"
    if [[ -n "$out" ]]; then
        echo "  stderr: $(echo "$out" | head -c 4000)" >&2
    fi
    return 1
}

task1_status=0
task2_status=0
task3_status=0

run_task task1 bash "$SCRIPT_DIR/tests/test_bug.sh" "$WS" "$SCRIPT_DIR" || task1_status=$?
run_task task2 bash "$SCRIPT_DIR/tests/test_feature.sh" "$WS" "$SCRIPT_DIR" || task2_status=$?

# Task 3: compile and run TestRefactor.hs against the workspace's library.
# Use ghc -i<workspace>/src so we don't depend on the cabal store layout.
test_refactor_dir=$(mktemp -d)
if ! ghc -O0 -i"$WS/src" "$SCRIPT_DIR/tests/TestRefactor.hs" \
        -o "$test_refactor_dir/test_refactor" \
        -odir "$test_refactor_dir" -hidir "$test_refactor_dir" \
        >"$test_refactor_dir/build.log" 2>&1; then
    echo "[task3] FAIL"
    echo "  stderr: $(head -c 4000 "$test_refactor_dir/build.log")" >&2
    task3_status=1
else
    if "$test_refactor_dir/test_refactor" 1>/dev/null 2>"$test_refactor_dir/run.log"; then
        echo "[task3] PASS"
    else
        echo "[task3] FAIL"
        echo "  stderr: $(head -c 4000 "$test_refactor_dir/run.log")" >&2
        task3_status=1
    fi
fi
rm -rf "$test_refactor_dir"

# Regression tests (advisory).
run_task reg1 bash "$SCRIPT_DIR/regression_tests/test_multidigit_mul.sh" "$WS" "$SCRIPT_DIR" || true
run_task reg2 bash "$SCRIPT_DIR/regression_tests/test_single_number.sh" "$WS" "$SCRIPT_DIR" || true
run_task reg3 bash "$SCRIPT_DIR/regression_tests/test_lex_unknown.sh" "$WS" "$SCRIPT_DIR" || true

if [[ $task1_status -eq 0 && $task2_status -eq 0 && $task3_status -eq 0 ]]; then
    exit 0
fi
exit 1
