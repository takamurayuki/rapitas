/**
 * backlog-job-labels
 *
 * Japanese display labels of the backlog's periodic jobs, used in run-now
 * completion notifications. Split out of backlog-scheduler.ts to keep that
 * file under the size limit.
 */
import type { BacklogJobKind } from './backlog-schedule-service';

// NOTE: Must stay in sync with rapitas-frontend/messages/ja.json
// backlog.settings.jobs.<kind>.label — the backend has no access to the
// frontend i18n bundle, so the labels are duplicated here for notifications.
export const BACKLOG_JOB_LABELS: Record<BacklogJobKind, string> = {
  innovation: 'イノベーションセッション',
  vuln_scan: '脆弱性・バグ調査',
  health_check: 'ログヘルスチェック',
  loop_review: '品質ループレビュー',
  ci_watch: 'CI 監視（本線）',
  daily_report: 'デイリーレポート',
  miss_ledger: '検出漏れ学習',
  gate_precision: 'ゲート精度較正',
  knowledge_reuse: '知識活用効果の測定',
  pr_risk_review: 'PR リスク予測の精度レビュー',
  outage_simulation: '障害影響判定シミュレーション',
};
