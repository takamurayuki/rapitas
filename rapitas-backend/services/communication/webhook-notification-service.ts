/**
 * WebhookNotificationService
 *
 * Delivers notifications to external webhook endpoints (Slack, Discord).
 * Not responsible for in-app notifications — those are handled by notification-service.ts.
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';

const log = createLogger('webhook-notification');

/** Webhook payload for Slack Incoming Webhook. */
type SlackPayload = {
  text: string;
  blocks?: Array<{
    type: string;
    text?: { type: string; text: string };
    elements?: Array<{ type: string; text: string }>;
  }>;
};

/** Webhook payload for Discord Webhook. */
type DiscordPayload = {
  content?: string;
  embeds?: Array<{
    title: string;
    description?: string;
    color?: number;
    fields?: Array<{ name: string; value: string; inline?: boolean }>;
    timestamp?: string;
  }>;
};

/** Event types that can trigger webhook notifications. */
export type WebhookEventType =
  | 'task_completed'
  | 'task_failed'
  | 'pr_created'
  | 'pr_merged'
  | 'execution_error'
  | 'safety_report_ready';

/**
 * Send a webhook notification for a given event.
 *
 * @param event - Event type / イベントタイプ
 * @param data - Event-specific payload / イベント固有のペイロード
 */
export async function sendWebhookNotification(
  event: WebhookEventType,
  data: { taskId?: number; taskTitle?: string; message: string; url?: string },
): Promise<void> {
  try {
    const settings = await prisma.userSettings.findFirst();
    if (!settings) return;

    // HACK(agent): Cast needed until prisma generate runs with new schema fields
    const settingsData = settings as Record<string, unknown>;
    const slackUrl = settingsData.slackWebhookUrl as string | undefined;
    const discordUrl = settingsData.discordWebhookUrl as string | undefined;

    if (!slackUrl && !discordUrl) return;

    const promises: Promise<void>[] = [];

    if (slackUrl) {
      promises.push(sendSlackNotification(slackUrl, event, data));
    }
    if (discordUrl) {
      promises.push(sendDiscordNotification(discordUrl, event, data));
    }

    await Promise.allSettled(promises);
  } catch (error) {
    // NOTE: Webhook failures should never block the main workflow
    log.error({ err: error }, '[Webhook] Failed to send notification');
  }
}

/**
 * Send a Slack notification via Incoming Webhook.
 *
 * @param webhookUrl - Slack webhook URL / Slack Webhook URL
 * @param event - Event type / イベントタイプ
 * @param data - Event data / イベントデータ
 */
async function sendSlackNotification(
  webhookUrl: string,
  event: WebhookEventType,
  data: { taskId?: number; taskTitle?: string; message: string; url?: string },
): Promise<void> {
  const emoji = getEventEmoji(event);
  const payload: SlackPayload = {
    text: `${emoji} ${data.message}`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `${emoji} *${getEventLabel(event)}*\n${data.message}${data.url ? `\n<${data.url}|詳細を確認>` : ''}`,
        },
      },
    ],
  };

  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) {
    log.warn(`[Webhook] Slack returned ${res.status}`);
  }
}

/**
 * Send a Discord notification via Webhook.
 *
 * @param webhookUrl - Discord webhook URL / Discord Webhook URL
 * @param event - Event type / イベントタイプ
 * @param data - Event data / イベントデータ
 */
async function sendDiscordNotification(
  webhookUrl: string,
  event: WebhookEventType,
  data: { taskId?: number; taskTitle?: string; message: string; url?: string },
): Promise<void> {
  const color = getEventColor(event);
  const payload: DiscordPayload = {
    embeds: [
      {
        title: `${getEventEmoji(event)} ${getEventLabel(event)}`,
        description: data.message + (data.url ? `\n[詳細を確認](${data.url})` : ''),
        color,
        timestamp: new Date().toISOString(),
        fields: data.taskId
          ? [{ name: 'Task', value: `#${data.taskId} ${data.taskTitle || ''}`, inline: true }]
          : undefined,
      },
    ],
  };

  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) {
    log.warn(`[Webhook] Discord returned ${res.status}`);
  }
}

function getEventEmoji(event: WebhookEventType): string {
  const map: Record<WebhookEventType, string> = {
    task_completed: '✅',
    task_failed: '❌',
    pr_created: '🔀',
    pr_merged: '🎉',
    execution_error: '⚠️',
    safety_report_ready: '🛡️',
  };
  return map[event] || '📋';
}

function getEventLabel(event: WebhookEventType): string {
  const map: Record<WebhookEventType, string> = {
    task_completed: 'タスク完了',
    task_failed: 'タスク失敗',
    pr_created: 'PR作成',
    pr_merged: 'PRマージ',
    execution_error: '実行エラー',
    safety_report_ready: 'セーフティレポート',
  };
  return map[event] || event;
}

function getEventColor(event: WebhookEventType): number {
  const map: Record<WebhookEventType, number> = {
    task_completed: 0x22c55e, // green
    task_failed: 0xef4444, // red
    pr_created: 0x3b82f6, // blue
    pr_merged: 0xa855f7, // purple
    execution_error: 0xf59e0b, // amber
    safety_report_ready: 0x06b6d4, // cyan
  };
  return map[event] || 0x6b7280;
}
