/**
 * gate-precision-watcher
 *
 * The "notice" stage for gate-precision: when a large share of recent
 * verify_repair disputes needed a human/plan-level hand to resolve (or never
 * resolved), the gate's own precision — not just the implementer's
 * diligence — is a plausible cause. Files ONE deduplicated concern per
 * firing, mirroring loop-watcher.ts's rule shape.
 * Not responsible for computing verdicts — see gate-precision-ledger.ts.
 */
import { createLogger } from '../../config/logger';
import { prisma } from '../../config/database';
import { submitConcern } from '../memory/concern-backlog-service';

const log = createLogger('self-improvement:gate-precision-watcher');

/** Minimum resolved disputes in the window before a rate is meaningful. */
const MIN_SAMPLE = 5;
/** Share of resolved_by_human + unresolved_blocked above which the gate is suspect. */
const DISPUTE_RATE_THRESHOLD = 0.4;

export interface GatePrecisionDisputeRow {
  verdict: string;
  taskId: number;
  criterionIndex: number | null;
  reason: string;
}

export interface GatePrecisionFinding {
  sample: number;
  humanOrBlockedRate: number;
  examplesSummary: string;
}

/**
 * Evaluate the gate-precision rule over pre-fetched rows. Pure — the
 * testable core.
 *
 * @param rows - Resolved disputes in the observation window. / 観測窓の解決済み紛糾
 * @returns The finding to file, or null when the sample is too small or the
 *   rate is not high enough to be actionable. / 起票すべき所見、無ければ null
 */
export function evaluateGatePrecisionRule(
  rows: GatePrecisionDisputeRow[],
): GatePrecisionFinding | null {
  if (rows.length < MIN_SAMPLE) return null;
  const humanOrBlocked = rows.filter(
    (r) => r.verdict === 'resolved_by_human' || r.verdict === 'unresolved_blocked',
  );
  const rate = humanOrBlocked.length / rows.length;
  if (rate < DISPUTE_RATE_THRESHOLD) return null;

  const examplesSummary = humanOrBlocked
    .slice(0, 5)
    .map((r) => `task ${r.taskId} 基準#${r.criterionIndex ?? '?'}: ${r.reason.slice(0, 80)}`)
    .join('\n');

  return { sample: rows.length, humanOrBlockedRate: rate, examplesSummary };
}

/**
 * Run one gate-precision review: read recently-resolved disputes, evaluate
 * the rule, file a deduplicated concern if it fires.
 *
 * @param opts.lookbackDays - Evidence window (default 14). / 遡り日数
 * @returns 1 if a concern was filed, else 0. / 起票件数
 */
export async function runGatePrecisionReview(
  opts: { lookbackDays?: number } = {},
): Promise<number> {
  const lookbackDays = opts.lookbackDays ?? 14;
  const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);
  const rows: GatePrecisionDisputeRow[] = await prisma.gatePrecisionCase
    .findMany({
      where: { detectedAt: { gte: since } },
      select: { verdict: true, taskId: true, criterionIndex: true, reason: true },
    })
    .catch(() => []);

  const finding = evaluateGatePrecisionRule(rows);
  if (!finding) return 0;

  try {
    await submitConcern({
      title: '品質ループ: verify_repair の紛糾が実装のやり直しだけで解決していない',
      detail:
        `直近${lookbackDays}日間で解決済みのverify_repair紛糾${finding.sample}件のうち、` +
        `人間/計画レベルの介入で解決したか、いまだ未解決(resolved_by_human + unresolved_blocked)が` +
        `${(finding.humanOrBlockedRate * 100).toFixed(0)}%を占める。実装の反復だけでは解決しない` +
        `割合が高い場合、受入基準の曖昧さやゲート自体の精度を疑う根拠になる。\n\n` +
        `代表例:\n${finding.examplesSummary}\n\n` +
        `詳細は GatePrecisionCase テーブル(gate=verify_repair)を参照。`,
      type: 'refactor',
      severity: 'medium',
      source: 'loop_review',
      // Stable key: the numbers change every review, but a persisting high
      // rate must UPDATE the picture via the open concern, not pile up copies.
      dedupKey: 'gate-precision-review:human-or-blocked-rate',
    });
    log.info({ finding }, '[gate-precision-watcher] concern filed');
    return 1;
  } catch (err) {
    log.warn({ err }, '[gate-precision-watcher] failed to file concern');
    return 0;
  }
}
