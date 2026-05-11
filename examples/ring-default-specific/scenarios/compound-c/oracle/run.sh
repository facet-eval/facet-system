#!/bin/bash
# Oracle entry point for compound-c.
# Args: $1 = workspace path (the agent's repo state).
#
# Behavior:
#   - Builds the workspace via `make`.
#   - Runs three task tests; prints "[taskN] PASS|FAIL" lines.
#   - Compiles + runs test_refactor.c against the library for task 3.
#   - Runs four regression tests; prints "[regN] PASS|FAIL" lines.
#   - Exit 0 iff all three task tests pass.

WS="$1"

if [[ -z "${WS:-}" || ! -d "$WS" ]]; then
    echo "oracle: missing or invalid workspace path: ${WS:-<unset>}" >&2
    exit 2
fi
if ! command -v make >/dev/null 2>&1; then
    echo "oracle: make not found on PATH" >&2
    exit 2
fi
if ! command -v cc >/dev/null 2>&1; then
    echo "oracle: cc not found on PATH" >&2
    exit 2
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILD_LOG=$(mktemp)
cleanup() { rm -f "$BUILD_LOG"; }
trap cleanup EXIT

# Build. A failed build cascades to 0/3 task tests (matches the
# design's documented C cascade behavior).
( cd "$WS" && make ) >"$BUILD_LOG" 2>&1
build_rc=$?
if [[ $build_rc -ne 0 ]]; then
    echo "oracle: make failed (exit=$build_rc)" >&2
    head -c 4000 "$BUILD_LOG" >&2
    echo "[task1] FAIL"
    echo "[task2] FAIL"
    echo "[task3] FAIL"
    exit 1
fi

if [[ ! -x "$WS/tlv" ]]; then
    echo "oracle: $WS/tlv missing or not executable after build" >&2
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

# Task 3: compile + run test_refactor.c against the workspace's library.
TR=$(mktemp -d)
TR_LOG="$TR/build.log"
if ! cc -Wall -std=c11 -I"$WS/include" "$SCRIPT_DIR/tests/test_refactor.c" \
        "$WS/libtlv.a" -o "$TR/test_refactor" >"$TR_LOG" 2>&1; then
    echo "[task3] FAIL"
    head -c 4000 "$TR_LOG" >&2
    task3_status=1
elif ! "$TR/test_refactor" >/dev/null 2>"$TR/run.log"; then
    echo "[task3] FAIL"
    head -c 4000 "$TR/run.log" >&2
    task3_status=1
else
    echo "[task3] PASS"
fi
rm -rf "$TR"

# Regression tests (advisory; do not affect exit code).
run_task reg1 bash "$SCRIPT_DIR/regression_tests/test_header_validation.sh" "$WS" "$SCRIPT_DIR" || true
run_task reg2 bash "$SCRIPT_DIR/regression_tests/test_existing_types_roundtrip.sh" "$WS" "$SCRIPT_DIR" || true
run_task reg3 bash "$SCRIPT_DIR/regression_tests/test_empty_records.sh" "$WS" "$SCRIPT_DIR" || true

# Reg4: compile + run test_io_helpers.c.
RT=$(mktemp -d)
if cc -Wall -std=c11 -I"$WS/include" "$SCRIPT_DIR/regression_tests/test_io_helpers.c" \
       "$WS/libtlv.a" -o "$RT/test_io_helpers" >"$RT/build.log" 2>&1 \
   && "$RT/test_io_helpers" >/dev/null 2>"$RT/run.log"; then
    echo "[reg4] PASS"
else
    echo "[reg4] FAIL"
    head -c 4000 "$RT/build.log" "$RT/run.log" 2>/dev/null >&2
fi
rm -rf "$RT"

if [[ $task1_status -eq 0 && $task2_status -eq 0 && $task3_status -eq 0 ]]; then
    exit 0
fi
exit 1
