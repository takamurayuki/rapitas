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
  {
    // ログ出力箇所: workflow-cli-executor-epilogue.ts:245-254 の log.warn
    // （文言は phase-output-validator-sections.ts:67 の validateSections が組み立てる）。
    // 236-238行のコメント通りログのみで phaseStatus を変えない fail-soft の観測ログで、
    // research の必須見出しは OR グループ（影響範囲/影響分析/統合点）のため、
    // いずれの見出しも無いと先頭の「影響範囲」が欠落として報告される（#1302）。
    // research.md 単独の「影響範囲」欠落に限定し、plan.md / verify.md の同種ログや
    // 複数見出しの欠落は別シグネチャのため抑制しない。
    test: /^\[WorkflowCLIExecutor\] research\.md missing sections: 影響範囲$/,
    logger: /^workflow-cli-executor$/i,
    because:
      'research.md の見出し欠落はログのみで進行を止めない fail-soft の観測 — 研究成果物の採否は後段のゲートが再検証する。plan/verify の欠落や複数見出し欠落は別シグネチャで可視のまま',
  },
];
