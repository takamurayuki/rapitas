/**
 * test-correlation-notifier
 *
 * Formats a PR test-risk scan result into a Slack/Discord/custom-webhook
 * notification via the shared webhook-notification-service, including each
 * risky test's confidence level and non-determinism flag so uncertainty is
 * never hidden from the reader (受入条件3).
 */
import { sendWebhookNotification } from '../../communication/webhook-notification-service';
import type { PrTestRiskEntry } from './pr-test-risk';

/** Number of top-risk tests included in the notification body. */
export const NOTIFY_TOP_N = 10;

const CONFIDENCE_LABEL: Record<PrTestRiskEntry['confidence'], string> = {
  high: '高',
  medium: '中',
  low: '低（サンプル不足の可能性）',
};

/**
 * Builds the human-readable notification message body for a PR test-risk scan.
 *
 * @param prNumber - PR number / PR番号
 * @param entries - Scored risk entries, already sorted descending / スコア済みリスク一覧
 * @returns Message text / 通知本文
 */
export function buildTestRiskMessage(prNumber: number, entries: PrTestRiskEntry[]): string {
  if (entries.length === 0) {
    return `PR #${prNumber}: 変更ファイルと相関のある落ちやすいテストは検出されませんでした。`;
  }

  const top = entries.slice(0, NOTIFY_TOP_N);
  const lines = top.map((e) => {
    const flags = [`信頼度: ${CONFIDENCE_LABEL[e.confidence]}`];
    if (e.nonDeterministic) flags.push('環境依存/非決定的の可能性あり');
    return `- ${e.testFile}: リスク ${(e.riskScore * 100).toFixed(0)}%（${flags.join(' / ')}）`;
  });

  return [
    `PR #${prNumber}: 変更ファイルとの相関から落ちやすいテスト ${entries.length} 件を検出しました（上位${top.length}件）`,
    ...lines,
  ].join('\n');
}

/**
 * Sends a Slack/Discord/custom-webhook notification for a PR's test-risk scan result.
 *
 * @param prNumber - PR number / PR番号
 * @param entries - Scored risk entries / スコア済みリスク一覧
 * @param prUrl - Optional PR URL for the notification's link field / PRのURL
 */
export async function notifyPrTestRisk(
  prNumber: number,
  entries: PrTestRiskEntry[],
  prUrl?: string,
): Promise<void> {
  await sendWebhookNotification('test_failure_correlation_alert', {
    message: buildTestRiskMessage(prNumber, entries),
    url: prUrl,
  });
}
