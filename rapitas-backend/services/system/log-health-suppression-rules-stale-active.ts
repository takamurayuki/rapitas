/**
 * log-health-suppression-rules-stale-active
 *
 * Suppression rule for the WorkflowRunner activeExecutions self-heal WARN. Split
 * from log-health-suppression-rules.ts, which sits at the line-count ratchet.
 */
import type { Suppression } from './log-health-suppressions-types';

/** Self-heal reports that describe a recovery, not a defect. */
export const STALE_ACTIVE_SUPPRESSIONS: Suppression[] = [
  {
    // ログ出力箇所: workflow-runner-stale-active.ts:100 の log.warn
    // （dropStaleActiveExecutions、processQueue 冒頭 workflow-runner.ts:177 から呼ばれる）。
    // DB上 running でなくなった項目（sweep・reconciler・停止操作）の Map エントリを
    // 落とすだけで、abort も DB 書き込みもしない設計（task 1165）。放置すると
    // MAX_CONCURRENCY=1 でスロットを占有し全キューが飢餓する。
    // 別文言の外部キャンセル解放ログ・チェック失敗ログは対象外（固定文言で絞る）。
    test: /^\[WorkflowRunner\] activeExecutions entry has no running DB item — dropping \(self-heal\)$/,
    logger: /^workflow-runner-stale-active$/i,
    because:
      '設計通りの自己修復の報告 — DBでrunningでなくなった項目のMapエントリを落とすだけで作業は失われず、放置すると並行枠を占有して全キューが飢餓する。スロット解放の追跡は別文言のreleaseログが残る',
  },
];
