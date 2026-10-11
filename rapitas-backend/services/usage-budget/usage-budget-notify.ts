/**
 * usage-budget-notify
 *
 * Builds and sends the `usage_budget_threshold` notification (80% / 90% /
 * exceeded) including the forecast remaining amount. Advisory only — sending
 * a notification never blocks or throttles an execution.
 */
import { createNotification } from '../communication/notification-service';
import type { PendingPrompt } from './usage-budget-types';

const LEVEL_TITLE: Record<PendingPrompt['level'], string> = {
  warn80: 'AI利用予算: 80%に到達しました',
  warn90: 'AI利用予算: 90%に到達しました',
  exceeded: 'AI利用予算: 上限を超過しました',
};

function formatAmount(n: number, unit: PendingPrompt['unit']): string {
  const v = Math.round(n).toLocaleString('ja-JP');
  return unit === 'tokens' ? `${v} トークン` : `${v} 回`;
}

/**
 * Compose the notification title and body for a threshold prompt.
 *
 * @param p - Pending prompt / 確認対象の状態
 * @returns Title and message / タイトルと本文
 */
export function buildThresholdMessage(p: PendingPrompt): { title: string; message: string } {
  const head = `今月の使用量 ${formatAmount(p.used, p.unit)} / 上限 ${formatAmount(p.limit, p.unit)}（残り ${formatAmount(p.remaining, p.unit)}）。`;
  const forecast =
    p.daysToExhaust === null
      ? '直近7日間の利用が無いため残量を予測できません。'
      : p.level === 'exceeded'
        ? `直近7日間の平均は 1日あたり ${formatAmount(p.avg7, p.unit)} です。`
        : `直近7日間の平均（1日あたり ${formatAmount(p.avg7, p.unit)}）から、約 ${Math.max(0, Math.floor(p.daysToExhaust * 10) / 10)} 日で上限に達する見込みです。`;
  return {
    title: LEVEL_TITLE[p.level],
    message: `${head}${forecast}実行は停止しません。続行・後回し・上限変更を選択できます。`,
  };
}

/**
 * Create the in-app threshold notification.
 *
 * @param p - Pending prompt / 確認対象の状態
 * @throws {Error} When the notification row cannot be created / 通知作成に失敗した場合
 */
export async function notifyUsageBudgetThreshold(p: PendingPrompt): Promise<void> {
  const { title, message } = buildThresholdMessage(p);
  await createNotification({
    type: 'usage_budget_threshold',
    title,
    message,
    link: '/agents/usage-budget',
    metadata: {
      key: p.key,
      level: p.level,
      unit: p.unit,
      used: p.used,
      limit: p.limit,
      remaining: p.remaining,
      daysToExhaust: p.daysToExhaust,
      projectedMonthEnd: p.projectedMonthEnd,
    },
  });
}
