/**
 * execution-cost-attribution
 *
 * Turns the cost column recorded on AgentExecution rows into what each
 * execution actually spent. Pure: no database, no clock, no policy.
 *
 * Why an attribution step is needed. `AgentExecution.costUsd` stores the Claude
 * CLI's `total_cost_usd` verbatim, and that field is the SESSION's cumulative
 * cost, not the invocation's. Measured against the CLI directly (haiku, same
 * session_id, `num_turns: 1` both times): a fresh run reported 0.00257 and a
 * `--resume` of it reported 0.00456. Adding the two rows claims 0.00713 for a
 * session that cost 0.00456, and the error grows with every repair cycle.
 *
 * Measured across 4,087 executions: #980 summed to $134.19 against a real
 * $24.02, #1214 to $44.95 against $14.83; the week to 2026-10-13 summed to
 * $523.84 against a real $357.66.
 *
 * Why increments rather than a session's maximum: 176 of 331 multi-execution
 * sessions record a DECREASE at some point (4.32 then 1.05), which is a fresh
 * chain reusing the id rather than a refund. Walking increments and treating a
 * drop as a new chain handles both shapes, and reduces to a plain sum when
 * every row is its own session.
 */

/** One execution's cost row. `costUsd` is `unknown` because Prisma hands back a Decimal. */
export interface CostRow {
  costUsd: unknown;
  claudeSessionId: string | null;
  startedAt: Date | null;
}

/**
 * Coerce a recorded cost (Prisma Decimal | number | string, including legacy
 * double-JSON-encoded values like `"\"0.5\""`) to a usable number.
 *
 * @param value - Raw column value / 生のカラム値
 * @returns Finite positive number, 0 for anything unusable / 使えない値は0
 */
export function coerceRecordedCost(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : 0;
  const parsed = Number.parseFloat(String(value).replace(/"/g, ''));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

/** Sort key: real time where known, otherwise last (a row with no start is pending). */
function startedMs(row: CostRow): number {
  return row.startedAt ? row.startedAt.getTime() : Number.MAX_SAFE_INTEGER;
}

/**
 * What each row spent on its own, aligned to the INPUT order.
 *
 * Increments are computed per `claudeSessionId` in time order regardless of the
 * order rows arrive in, then mapped back, so a caller can zip the result with
 * its own list by index.
 *
 * @param rows - Cost rows, in any order / コスト行（順序は任意）
 * @returns Per-row incremental cost, same length and order as `rows` / 行ごとの増分
 */
export function attributeIncrementalCosts<T extends CostRow>(rows: readonly T[]): number[] {
  const increments = new Array<number>(rows.length).fill(0);
  const chains = new Map<string, number[]>();

  rows.forEach((row, index) => {
    const key = row.claudeSessionId;
    if (!key) {
      // No session id means nothing can be cumulative with it.
      increments[index] = coerceRecordedCost(row.costUsd);
      return;
    }
    const chain = chains.get(key);
    if (chain) chain.push(index);
    else chains.set(key, [index]);
  });

  for (const chain of chains.values()) {
    chain.sort((a, b) => startedMs(rows[a]) - startedMs(rows[b]));
    let previous = 0;
    for (const index of chain) {
      const cost = coerceRecordedCost(rows[index].costUsd);
      // Only a DROP means the id was reused by a new chain, so the whole value
      // is new spend. An equal value is the same cumulative total reported
      // again — zero increment, not a second chain that spent exactly as much.
      increments[index] = cost >= previous ? cost - previous : cost;
      previous = cost;
    }
  }
  return increments;
}

/**
 * Total spend over rows, estimating only the rows that recorded no cost at all.
 *
 * A zero INCREMENT is not a missing cost — it is the same cumulative total
 * reported a second time. Falling back to an estimate there would add a
 * phantom charge on every resume, so the fallback keys on the recorded value.
 *
 * @param rows - Cost rows / コスト行
 * @param estimateLegacy - Cost for a row that recorded none / 記録が無い行の推定
 * @returns Total spend / 合計
 */
export function sumAttributedSpend<T extends CostRow>(
  rows: readonly T[],
  estimateLegacy: (row: T) => number,
): number {
  const increments = attributeIncrementalCosts(rows);
  let total = 0;
  rows.forEach((row, index) => {
    total += coerceRecordedCost(row.costUsd) > 0 ? increments[index] : estimateLegacy(row);
  });
  return total;
}
