/**
 * Notification Service
 *
 * Creates notifications and delivers them in real-time via SSE.
 * Also forwards to external webhooks (Slack/Discord) when configured.
 */
import { prisma } from '../../config/database';
import { realtimeService } from './realtime-service';
import { sendWebhookNotification, type WebhookEventType } from './webhook-notification-service';
import { buildNotificationI18n, type NotificationI18n } from './notification-i18n';

// NOTE: Several notification-generating modules bypass this union entirely by
// calling `prisma.notification.create`/`notify()` directly with a raw string
// type (auto-run-notifications.ts, auto-merge-notify.ts, task-mutations.ts,
// etc. — see research.md #763). This union covers only the types created
// through `createNotification` in THIS file; it is intentionally not the
// single source of truth for every `Notification.type` value in the DB.
export type NotificationType =
  | 'task_completed'
  | 'task_assigned'
  | 'agent_execution_completed'
  | 'agent_execution_failed'
  | 'agent_execution_resumed'
  | 'approval_requested'
  | 'approval_completed'
  | 'pomodoro_completed'
  | 'habit_reminder'
  | 'schedule_reminder'
  | 'memo_reminder'
  | 'contradiction_detected'
  | 'consolidation_completed'
  | 'daily_report'
  | 'knowledge_extracted'
  | 'system';

interface CreateNotificationParams {
  type: NotificationType;
  title: string;
  message: string;
  link?: string;
  metadata?: Record<string, unknown>;
  /** i18n pointer for locale-aware re-translation — see notification-i18n.ts. */
  i18n?: NotificationI18n;
}

/**
 * Create a notification and deliver it in real-time via SSE.
 */
export async function createNotification(params: CreateNotificationParams) {
  const metadata =
    params.metadata || params.i18n
      ? { ...params.metadata, ...(params.i18n ? { i18n: params.i18n } : {}) }
      : null;
  const notification = await prisma.notification.create({
    data: {
      type: params.type,
      title: params.title,
      message: params.message,
      link: params.link,
      metadata: metadata ? JSON.stringify(metadata) : null,
    },
  });

  // Deliver in real-time via SSE
  const unreadCount = await prisma.notification.count({ where: { isRead: false } });
  realtimeService.broadcast('notifications', 'new_notification', {
    notification,
    unreadCount,
  });

  return notification;
}

/**
 * Send a task completion notification (in-app + external webhooks).
 */
export async function notifyTaskCompleted(taskId: number, taskTitle: string) {
  // NOTE: Fire-and-forget webhook — should not block in-app notification
  void sendWebhookNotification('task_completed', {
    taskId,
    taskTitle,
    message: `タスク「${taskTitle}」が完了しました`,
    url: `/tasks?taskId=${taskId}`,
  });

  return createNotification({
    type: 'task_completed',
    title: 'タスク完了',
    message: `「${taskTitle}」が完了しました`,
    link: `/tasks?taskId=${taskId}`,
    metadata: { taskId },
    i18n: buildNotificationI18n('task_completed', { taskTitle }),
  });
}

/**
 * Send an AI execution completion notification (in-app + external webhooks).
 */
export async function notifyAgentExecutionCompleted(
  executionId: number,
  taskTitle: string,
  success: boolean,
) {
  const webhookEvent: WebhookEventType = success ? 'task_completed' : 'execution_error';
  void sendWebhookNotification(webhookEvent, {
    taskId: executionId,
    taskTitle,
    message: success ? `AI実行完了: 「${taskTitle}」` : `AI実行失敗: 「${taskTitle}」`,
  });

  const type = success ? 'agent_execution_completed' : 'agent_execution_failed';
  return createNotification({
    type,
    title: success ? 'AI実行完了' : 'AI実行失敗',
    message: success
      ? `「${taskTitle}」のAI実行が完了しました`
      : `「${taskTitle}」のAI実行が失敗しました`,
    link: `/tasks?taskId=${executionId}`,
    metadata: { executionId },
    i18n: buildNotificationI18n(type, { taskTitle }),
  });
}

/**
 * Send an approval request notification.
 */
export async function notifyApprovalRequested(approvalId: number, title: string) {
  return createNotification({
    type: 'approval_requested',
    title: '承認リクエスト',
    message: `「${title}」の承認が必要です`,
    link: `/approvals`,
    metadata: { approvalId },
    i18n: buildNotificationI18n('approval_requested', { title }),
  });
}

/** Title used for auth-failure notifications — also the dedup match key. */
export const AUTH_FAILURE_NOTIFICATION_TITLE = 'Claude 認証切れ';

// One auth alert per episode. Auth breakage fails EVERY queued task's every
// phase, so without this the feed floods with identical notifications.
const AUTH_NOTIFY_WINDOW_MS = 10 * 60 * 1000;

/**
 * Notify the user that the Claude CLI authentication expired/failed, so auto-run
 * agents cannot execute until re-authentication. Deduplicated to one
 * notification per AUTH_NOTIFY_WINDOW_MS.
 *
 * @returns The created notification, or null when suppressed by dedup. / 作成した通知、重複抑制時は null
 */
export async function notifyAuthenticationFailure() {
  // Suppress when an auth alert already fired within the window.
  const since = new Date(Date.now() - AUTH_NOTIFY_WINDOW_MS);
  const recent = await prisma.notification.findFirst({
    where: {
      type: 'system',
      title: AUTH_FAILURE_NOTIFICATION_TITLE,
      createdAt: { gte: since },
    },
    orderBy: { createdAt: 'desc' },
  });
  if (recent) return null;

  return createNotification({
    type: 'system',
    title: AUTH_FAILURE_NOTIFICATION_TITLE,
    message:
      'Claude CLI の認証が切れたため、自動実行エージェントが起動できません。統合ターミナルで `claude login` を実行して再認証してください。再認証後、ブロックされたタスクは自動で再試行されます。',
    link: '/',
    metadata: { reason: 'auth_expired', action: 'reauthenticate', command: 'claude login' },
    i18n: buildNotificationI18n('auth_failure'),
  });
}

/** Title used for intake-question-pending notifications — also the dedup match key. */
export const INTAKE_QUESTION_NOTIFICATION_TITLE = '確認の質問が回答待ちです';

// Dedup window doubles as the re-notify interval. Rationale: tasks #578/#579
// sat awaiting_question for 4 days (2026-08-13T13:48:35Z → 2026-08-17) with
// zero notifications; a daily reminder is enough recall while keeping feed
// noise minimal (an unanswered question never advances on its own).
export const INTAKE_QUESTION_NOTIFY_WINDOW_MS =
  parseInt(process.env.RAPITAS_INTAKE_QUESTION_NOTIFY_WINDOW_MS ?? '', 10) || 24 * 60 * 60 * 1000;

/**
 * Notify the user that a task is paused on an unanswered intake question.
 * Shared by the intake gate (initial notice) and the self-incident watcher
 * (re-notice for stale waits): both go through the same title+link dedup
 * window, so a single query suppresses duplicates across BOTH paths.
 *
 * @param params.taskId - Task paused on the question. / 質問待ちのタスクID
 * @param params.taskTitle - Task title for the message. / 通知本文用のタスク名
 * @param params.nowMs - Current time (ms); injectable for tests. / 現在時刻
 * @returns The created notification, or null when suppressed by dedup. / 作成した通知、重複抑制時は null
 */
export async function notifyIntakeQuestionPending(params: {
  taskId: number;
  taskTitle: string;
  nowMs?: number;
}) {
  // NOTE: /?panel=<id> is the only link that reaches the answer UI (home slide
  // panel restore) — the conventional /tasks?taskId= has no frontend route (404).
  const link = `/?panel=${params.taskId}`;
  const nowMs = params.nowMs ?? Date.now();
  const since = new Date(nowMs - INTAKE_QUESTION_NOTIFY_WINDOW_MS);
  const recent = await prisma.notification.findFirst({
    where: {
      type: 'system',
      title: INTAKE_QUESTION_NOTIFICATION_TITLE,
      link,
      createdAt: { gte: since },
    },
    orderBy: { createdAt: 'desc' },
  });
  if (recent) return null;

  return createNotification({
    type: 'system',
    title: INTAKE_QUESTION_NOTIFICATION_TITLE,
    message: `タスク #${params.taskId}「${params.taskTitle}」は確認の質問に回答があるまで進みません。通知を開いて回答してください。`,
    link,
    metadata: { taskId: params.taskId, reason: 'intake_question_pending' },
    i18n: buildNotificationI18n('intake_question_pending', {
      taskId: params.taskId,
      taskTitle: params.taskTitle,
    }),
  });
}

/**
 * Notify that a stale `awaiting_question` task had its recommended option
 * auto-adopted after a long unattended wait (see
 * workflow-reconciler-question-auto-answer.ts). Distinct from
 * {@link notifyIntakeQuestionPending} — that one asks the user to respond;
 * this one tells them a response was already applied on their behalf.
 *
 * @param taskId - Task whose question was auto-answered. / 自動採用したタスクID
 * @param taskTitle - Task title for the message. / 通知本文用のタスク名
 * @param recommendedLabel - Label of the option that was adopted. / 採用した選択肢の表示文
 * @param elapsedMinutes - Minutes the question sat unanswered. / 無応答だった分数
 */
export async function notifyQuestionAutoAnswered(
  taskId: number,
  taskTitle: string,
  recommendedLabel: string,
  elapsedMinutes: number,
) {
  return createNotification({
    type: 'system',
    title: '質問の推奨案を自動採用しました',
    message: `タスク「${taskTitle}」の質問で推奨『${recommendedLabel}』を自動採用しました（${elapsedMinutes}分無応答）。変更する場合は基準を訂正して再実行してください。`,
    link: `/?panel=${taskId}`,
    metadata: { taskId, reason: 'auto_recommended', recommendedLabel, elapsedMinutes },
    i18n: buildNotificationI18n('question_auto_answered', {
      taskTitle,
      recommendedLabel,
      elapsedMinutes,
    }),
  });
}

/**
 * Send a pomodoro completion notification.
 */
export async function notifyPomodoroCompleted(taskTitle: string | null, completedCount: number) {
  return createNotification({
    type: 'pomodoro_completed',
    title: 'ポモドーロ完了',
    message: taskTitle
      ? `「${taskTitle}」のポモドーロ #${completedCount} が完了しました`
      : `ポモドーロ #${completedCount} が完了しました`,
    i18n: buildNotificationI18n(taskTitle ? 'pomodoro_completed' : 'pomodoro_completed_no_task', {
      taskTitle,
      completedCount,
    }),
  });
}

/**
 * Send a knowledge-auto-extraction-complete notification.
 *
 * Lives here (rather than inline in task-knowledge-extractor.ts) to keep that
 * already-oversized file from growing further — see COMPONENT_SPLITTING_POLICY.md.
 *
 * @param taskId - Task the knowledge was extracted from. / 抽出元タスクID
 * @param taskTitle - Task title for the message. / 通知本文用のタスク名
 * @param entryIds - Created KnowledgeEntry ids. / 作成されたエントリID一覧
 */
export async function notifyKnowledgeExtracted(
  taskId: number,
  taskTitle: string,
  entryIds: number[],
) {
  return createNotification({
    type: 'knowledge_extracted',
    title: 'ナレッジ自動抽出完了',
    message: `タスク「${taskTitle}」から${entryIds.length}件のナレッジを抽出しました`,
    link: '/knowledge',
    metadata: { taskId, entryIds },
    i18n: buildNotificationI18n('knowledge_extracted', { taskTitle, count: entryIds.length }),
  });
}
