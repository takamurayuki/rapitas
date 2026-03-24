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
  | 'safety_report_ready'
  | 'task_created'
  | 'agent_execution_completed'
  | 'knowledge_created';

/** Custom webhook endpoint configuration. */
export interface CustomWebhook {
  url: string;
  events: WebhookEventType[];
  headers?: Record<string, string>;
  /** If true, send raw JSON payload. If false, use platform-specific formatting. */
  rawPayload?: boolean;
}

/** In-memory store for custom webhooks (loaded from settings on first use). */
let customWebhooksCache: CustomWebhook[] | null = null;

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

    // Custom webhook endpoints with event filtering
    const customWebhooks = await getCustomWebhooks();
    for (const webhook of customWebhooks) {
      if (webhook.events.length === 0 || webhook.events.includes(event)) {
        promises.push(sendCustomWebhook(webhook, event, data));
      }
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
  const map: Partial<Record<WebhookEventType, number>> = {
    task_completed: 0x22c55e,
    task_failed: 0xef4444,
    pr_created: 0x3b82f6,
    pr_merged: 0xa855f7,
    execution_error: 0xf59e0b,
    safety_report_ready: 0x06b6d4,
    task_created: 0x3b82f6,
    agent_execution_completed: 0x22c55e,
    knowledge_created: 0x8b5cf6,
  };
  return map[event] || 0x6b7280;
}

/**
 * Load custom webhook endpoints from UserSettings.
 *
 * Parses the JSON stored in a custom field. Caches the result in memory
 * to avoid repeated DB lookups.
 */
async function getCustomWebhooks(): Promise<CustomWebhook[]> {
  if (customWebhooksCache !== null) return customWebhooksCache;

  try {
    const settings = await prisma.userSettings.findFirst();
    if (!settings) {
      customWebhooksCache = [];
      return [];
    }

    const raw = (settings as Record<string, unknown>).customWebhooks as string | undefined;
    if (!raw) {
      customWebhooksCache = [];
      return [];
    }

    customWebhooksCache = JSON.parse(raw) as CustomWebhook[];
    return customWebhooksCache;
  } catch {
    customWebhooksCache = [];
    return [];
  }
}

/**
 * Send a notification to a custom webhook endpoint.
 *
 * Sends a standardized JSON payload with event type, data, and timestamp.
 *
 * @param webhook - Custom webhook configuration. / カスタムWebhook設定
 * @param event - Event type. / イベントタイプ
 * @param data - Event data. / イベントデータ
 */
async function sendCustomWebhook(
  webhook: CustomWebhook,
  event: WebhookEventType,
  data: { taskId?: number; taskTitle?: string; message: string; url?: string },
): Promise<void> {
  try {
    const payload = {
      event,
      timestamp: new Date().toISOString(),
      data: {
        taskId: data.taskId,
        taskTitle: data.taskTitle,
        message: data.message,
        url: data.url,
      },
    };

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...webhook.headers,
    };

    const res = await fetch(webhook.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      log.warn({ url: webhook.url, status: res.status }, '[Webhook] Custom webhook returned error');
    }
  } catch (error) {
    log.warn({ err: error, url: webhook.url }, '[Webhook] Custom webhook failed');
  }
}

/**
 * Invalidate the custom webhooks cache.
 *
 * Call this when UserSettings are updated to reload custom webhook config.
 */
export function invalidateWebhookCache(): void {
  customWebhooksCache = null;
}
