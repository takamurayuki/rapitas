/**
 * Gate Misjudgment Filer
 *
 * Files a concern for each verify-contradiction sentence pattern that repeats
 * at least GATE_MISJUDGMENT_THRESHOLD times in a window — a candidate gate
 * misjudgment. Duplicates are prevented by a per-pattern dedupKey.
 */
import { createLogger } from '../../config/logger';
import { submitConcern } from '../memory/concern-backlog-service';
import type { BounceBreakdown } from './bounce-breakdown';

const log = createLogger('self-improvement:gate-misjudgment-filer');

/** Same-pattern occurrences per window that make a gate-misjudgment candidate. */
export const GATE_MISJUDGMENT_THRESHOLD = 3;

/**
 * File concerns for repeated contradiction patterns.
 *
 * @param patterns - Window contradiction patterns. / 窓内の矛盾判定パターン
 * @returns Number of newly created concerns (reused/suppressed not counted). / 新規起票数
 */
export async function fileGateMisjudgmentCandidates(
  patterns: BounceBreakdown['contradictionPatterns'] | undefined,
): Promise<number> {
  let created = 0;
  for (const p of patterns ?? []) {
    if (p.count < GATE_MISJUDGMENT_THRESHOLD) continue;
    try {
      const res: unknown = await submitConcern({
        title: `ゲート誤判定の候補: 検証レポートの矛盾判定が同一文言で週 ${p.count} 回`,
        detail:
          `同じ文言パターンで「検証レポートを矛盾と判定」の差し戻しが直近窓で ${p.count} 回起きています。` +
          `ゲートの誤判定（環境の拒否と代替を矛盾と判定する類）の可能性があります。\n\n` +
          `例: ${p.sample}\n\nパターンID: ${p.patternId}`,
        type: 'bug',
        severity: 'medium',
        source: 'loop_review',
        dedupKey: `loop-review:gate-misjudgment:${p.patternId}`,
      });
      if ((res as { outcome?: string } | null)?.outcome === 'created') created++;
    } catch (err) {
      log.warn({ err, pattern: p.patternId }, '[gate-misjudgment] failed to file concern');
    }
  }
  return created;
}
