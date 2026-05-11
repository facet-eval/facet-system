// Cost / token guardrails for runAll. Two error classes the CLI surfaces by
// `error.name` (so they propagate through the existing per-run summary path
// without a new RunStatus variant), plus a tiny accumulator the matrix loop
// reads after each successful run. Node is single-threaded for JS, so the
// plain `let`-equivalent on the class is safe between await points; a brief
// over-shoot bounded by `parallelism - 1` is the documented trade-off.

export class BudgetExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BudgetExceededError";
  }
}

export class TokenOverflowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TokenOverflowError";
  }
}

export class BudgetTracker {
  private _cumulativeCostUsd = 0;
  private _aborted = false;
  private _abortReason: string | undefined;

  constructor(private readonly capUsd: number) {}

  get cumulativeCostUsd(): number {
    return this._cumulativeCostUsd;
  }
  get aborted(): boolean {
    return this._aborted;
  }
  get abortReason(): string | undefined {
    return this._abortReason;
  }

  recordRun(costUsd: number): void {
    if (Number.isFinite(costUsd) && costUsd > 0) {
      this._cumulativeCostUsd += costUsd;
    }
    if (!this._aborted && this._cumulativeCostUsd >= this.capUsd) {
      this._aborted = true;
      this._abortReason = `max_total_cost_usd reached: $${this._cumulativeCostUsd.toFixed(6)} of $${this.capUsd.toFixed(6)} USD`;
    }
  }

  buildSkipReason(): string {
    return this._abortReason ?? "max_total_cost_usd reached";
  }
}

export function assertNoTokenOverflow(
  tokensTotal: number,
  maxTokensPerRun: number,
  runId: string,
): void {
  if (tokensTotal > maxTokensPerRun) {
    throw new TokenOverflowError(
      `run ${runId} consumed ${tokensTotal} tokens, exceeding max_tokens_per_run=${maxTokensPerRun}`,
    );
  }
}
