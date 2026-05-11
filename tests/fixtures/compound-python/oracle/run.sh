#!/bin/bash
# Oracle entry point for compound-python.
# Args: $1 = workspace path (the agent's repo state).
#
# Behavior:
#   - Smoke import check on the agent's notifier package.
#   - Runs the three task tests; prints "[taskN] PASS|FAIL" lines.
#   - Runs the four regression tests; prints "[regN] PASS|FAIL" lines.
#   - Exit 0 iff all three task tests pass (binary contract for Bullet 5).
#   - Regression tests are descriptive only (per study-design §13.1) and do
#     not affect the exit code.

WS="$1"

if [[ -z "${WS:-}" || ! -d "$WS" ]]; then
    echo "oracle: missing or invalid workspace path: ${WS:-<unset>}" >&2
    exit 2
fi

if ! command -v python3 >/dev/null 2>&1; then
    echo "oracle: python3 not found on PATH" >&2
    exit 2
fi

PY=$(command -v python3)

# Resolve oracle dir (this script's parent).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Smoke import check — package must at least be importable.
if ! PYTHONPATH="$WS" "$PY" -c "import notifier" 2>/dev/null; then
    echo "oracle: cannot import notifier from workspace $WS" >&2
    echo "[task1] FAIL"
    echo "[task2] FAIL"
    echo "[task3] FAIL"
    exit 1
fi

run_task() {
    local label="$1"
    local cmd_status
    shift
    "$@" >/tmp/oracle_stdout.$$ 2>/tmp/oracle_stderr.$$
    cmd_status=$?
    if [[ $cmd_status -eq 0 ]]; then
        echo "[$label] PASS"
        rm -f /tmp/oracle_stdout.$$ /tmp/oracle_stderr.$$
        return 0
    fi
    echo "[$label] FAIL"
    if [[ -s /tmp/oracle_stderr.$$ ]]; then
        echo "  stderr: $(head -c 4000 /tmp/oracle_stderr.$$)" >&2
    fi
    rm -f /tmp/oracle_stdout.$$ /tmp/oracle_stderr.$$
    return 1
}

task1_status=0
task2_status=0
task3_status=0

run_task task1 bash "$SCRIPT_DIR/tests/test_bug.sh" "$WS" "$SCRIPT_DIR" || task1_status=$?
PYTHONPATH="$WS" run_task task2 "$PY" "$SCRIPT_DIR/tests/test_feature.py" || task2_status=$?
PYTHONPATH="$WS" run_task task3 "$PY" "$SCRIPT_DIR/tests/test_refactor.py" || task3_status=$?

# Regression tests are advisory.
PYTHONPATH="$WS" run_task reg1 "$PY" "$SCRIPT_DIR/regression_tests/test_isolated_matchers.py" || true
run_task reg2 bash "$SCRIPT_DIR/regression_tests/test_slack_log_format.sh" "$WS" "$SCRIPT_DIR" || true
PYTHONPATH="$WS" run_task reg3 "$PY" "$SCRIPT_DIR/regression_tests/test_dispatch_unknown.py" || true
run_task reg4 bash "$SCRIPT_DIR/regression_tests/test_multi_event_cli.sh" "$WS" "$SCRIPT_DIR" || true

if [[ $task1_status -eq 0 && $task2_status -eq 0 && $task3_status -eq 0 ]]; then
    exit 0
fi
exit 1
