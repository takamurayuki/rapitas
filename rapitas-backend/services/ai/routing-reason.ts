/**
 * routing-reason
 *
 * Builds the human-readable explanation attached to a SmartRouter decision
 * (log line, decision-trace `adoptedReason`, UI cost explorer). Pure string
 * assembly — it never influences which model is selected.
 */

/** What actually decided the tier, in the order SmartRouter applies them. */
export type RouteDriver = 'floor' | 'evidence' | 'budget' | 'complexity';

/**
 * Explain why a tier was chosen.
 *
 * NOTE: The driver is passed in rather than re-derived from complexity. The
 * previous inline version fell through to the complexity branch whenever a
 * role/risk/retry FLOOR had overridden the heuristic, producing lines like
 * 「複雑度5（低）のためpremiumモデルで十分」 — the tier and the stated cause
 * contradicted each other. Measured 2026-08-23, 55% of routing decisions
 * resolved to premium and the trace attributed every one of them to
 * complexity, which made the premium share impossible to audit after the fact.
 *
 * @param opts.tier - The tier finally selected. / 最終的に選択されたティア
 * @param opts.complexity - Task complexity score used by the heuristic. / 複雑度スコア
 * @param opts.driver - Which rule set the tier. / ティアを決めた要因
 * @param opts.floorReason - Why the floor applied, when driver is 'floor'. / 下限適用の理由
 * @returns One-sentence Japanese explanation. / 日本語の理由文
 */
export function buildRouteReason(opts: {
  tier: string;
  complexity: number;
  driver: RouteDriver;
  floorReason?: string;
}): string {
  const { tier, complexity, driver } = opts;
  switch (driver) {
    case 'floor':
      return `${opts.floorReason ?? 'ロール下限'}のため${tier}モデルまで引き上げ（複雑度${complexity}）`;
    case 'evidence':
      return `直近の実行実績でこのロールは${tier}モデルの成功率が高いため引き下げ`;
    case 'budget':
      return `予算残高が少ないため${tier}モデルを推奨`;
    default:
      return complexity <= 35
        ? `複雑度${complexity}（低）のため${tier}モデルで十分`
        : complexity > 70
          ? `複雑度${complexity}（高）のため${tier}モデルを推奨`
          : `複雑度${complexity}（中）に基づき${tier}モデルを推奨`;
  }
}
