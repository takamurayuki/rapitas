/**
 * log-health-suppressions
 *
 * Decides which log lines are worth filing as concerns.
 *
 * The health check used to file every warn-or-worse line it saw. Measured
 * 2026-08-27 on the rapitas backlog: 60 of 121 open concerns came from this
 * path, and almost none named anything that was left broken — a guard refusing
 * an unsafe branch switch, a reconciler recovering a starved queue, an optional
 * provider being absent. Those lines are the system WORKING.
 *
 * The rule this module encodes: a log line is a concern only when something was
 * left broken. A guard that refused, a recovery that succeeded, and a fail-open
 * that continued all leave nothing to fix, however alarming the wording.
 */

/** One suppression rule and the reason it is safe to drop the line. */
interface Suppression {
  /** Matches the normalized message (and optionally the logger name). */
  test: RegExp;
  /** Restrict to one logger when the phrase alone is too broad. */
  logger?: RegExp;
  /** Why this line leaves nothing broken. Shown in the audit log. */
  because: string;
}

/**
 * Lines that report a guard, a recovery, or an expected condition.
 *
 * Each entry names why nothing is left broken. A rule that cannot state that
 * does not belong here — the fallback is to file the concern, because a missed
 * suppression costs one noisy row while a wrong one hides a real defect.
 */
const SUPPRESSIONS: Suppression[] = [
  {
    test: /Refusing to (switch|create|commit|delete|reset)/i,
    because: 'ガードが危険な操作を拒否した — 防いだ側であり、壊れていない',
  },
  {
    test: /primary working tree — skipping|to protect \w+/i,
    because: 'プライマリ保護ガードが働いた',
  },
  {
    test: /Queue starvation detected — restarted|re-enqueued to resume|was already queued; tracking/i,
    because: '自己修復が成功している — 検出して回復した記録',
  },
  {
    test: /Working tree dirty (at boundary )?— (skipping|restart skipped)/i,
    because: '安全条件が揃わないため再起動を見送った — 意図した挙動',
  },
  {
    test: /auto-run dry \+ new commits.*restarting to apply updates/i,
    because: '設定どおりの計画的な再起動',
  },
  {
    test: /Already running/i,
    logger: /workflow-runner/i,
    because: '多重起動を防ぐ通常の状態報告',
  },
  {
    test: /Ollama probe failed|Unable to connect.*ollama/i,
    because: '任意プロバイダが不在なだけ — 必須ではない',
  },
  {
    test: /fail-open|skipping \(fail-open\)/i,
    because: '明示的に fail-open として継続している',
  },
  {
    test: /Worker process exited/i,
    logger: /agent-worker-manager/i,
    because: 'シャットダウン時の通常終了 — クラッシュは別シグネチャで記録される',
  },
  {
    test: /self-repair|re-running implement→verify/i,
    because: '差し戻しループは専用の収束検出が担当する — ログ経由の二重起票',
  },
  {
    test: /shutting down, cannot start|interrupted by shutdown/i,
    because: '停止処理中の想定内メッセージ — 再起動後に解消する',
  },
  {
    test: /verify\.md (failed validation|self-contradicts)/i,
    because: '検証ゲートが不正な成果物を捕捉した — ゲートが働いた側',
  },
];

/** Result of classifying one log signature. */
export interface SuppressionVerdict {
  /** True when the line should NOT become a concern. */
  suppressed: boolean;
  /** Why, when suppressed. */
  because?: string;
}

/**
 * Whether a log line reports something that was left broken.
 *
 * @param name - Logger name. / ロガー名
 * @param normalizedMsg - Normalized message body. / 正規化済みメッセージ
 * @returns Verdict with the reason when suppressed. / 判定と理由
 */
export function classifyLogSignature(name: string, normalizedMsg: string): SuppressionVerdict {
  for (const rule of SUPPRESSIONS) {
    if (rule.logger && !rule.logger.test(name)) continue;
    if (rule.test.test(normalizedMsg)) return { suppressed: true, because: rule.because };
  }
  return { suppressed: false };
}
