/**
 * log-health-suppression-rules-backlog
 *
 * Suppression rules for backlog-scheduler timing diagnostics. Split from
 * log-health-suppression-rules.ts, which sits at the line-count ratchet.
 */
import type { Suppression } from './log-health-suppressions-types';

/** Backlog scheduler diagnostics that report duration, not a defect. */
export const BACKLOG_SUPPRESSIONS: Suppression[] = [
  {
    // ログ出力箇所: backlog-scheduler.ts:171 の log.warn（tookMs > 3000 の時のみ）。
    // 毎日06:00頃のイベントループ停止(concern #514)調査用の計装で、ジョブ本体は
    // LLM呼び出し・ログ走査を含み所要が負荷依存（過去 7s〜383s: K-8758/K-11867/K-12456/K-13096）。
    // 例外は :177 の catch で再throwされ別経路で可視、病的スタールは
    // event-loop-lag の self-heal(ERROR)が検知し、kind/tookMs は構造化フィールドに残る。
    // 正規化後は "Backlog job ran #s" / "#.#s"。ジョブ失敗の文言は別なので対象外。
    test: /^Backlog job ran #(?:\.#)?s$/,
    logger: /^scheduling:backlog$/i,
    because:
      '3秒超の実行時間を記録しただけの計装 — ジョブは重い処理を含み所要は負荷依存、失敗は例外経路で別途可視、病的スタールはSelf-healing(ERROR)が検知し、tookMs等は構造化フィールドに残る',
  },
];
