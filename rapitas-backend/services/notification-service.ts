/**
 * Notification Service
 * 通知の作成とリアルタイム配信を統合
 */
import { prisma } from "../config/database";
import { realtimeService } from "./realtime-service";

export type NotificationType =
  | "task_completed"
  | "task_assigned"
  | "agent_execution_completed"
  | "agent_execution_failed"
  | "agent_execution_resumed"
  | "approval_requested"
  | "approval_completed"
  | "pomodoro_completed"
  | "habit_reminder"
  | "schedule_reminder"
  | "contradiction_detected"
  | "consolidation_completed"
  | "system";

interface CreateNotificationParams {
  type: NotificationType;
  title: string;
  message: string;
  link?: string;
  metadata?: Record<string, unknown>;
}

/**
 * 通知を作成し、SSE経由でリアルタイム配信する
 */
export async function createNotification(params: CreateNotificationParams) {
  const notification = await prisma.notification.create({
    data: {
      type: params.type,
      title: params.title,
      message: params.message,
      link: params.link,
      metadata: params.metadata ? JSON.stringify(params.metadata) : null,
    },
  });

  // SSE経由でリアルタイム配信
  const unreadCount = await prisma.notification.count({ where: { isRead: false } });
  realtimeService.broadcast("notifications", "new_notification", {
    notification,
    unreadCount,
  });

  return notification;
}

/**
 * タスク完了通知
 */
export async function notifyTaskCompleted(taskId: number, taskTitle: string) {
  return createNotification({
    type: "task_completed",
    title: "タスク完了",
    message: `「${taskTitle}」が完了しました`,
    link: `/tasks?taskId=${taskId}`,
    metadata: { taskId },
  });
}

/**
 * AI実行完了通知
 */
export async function notifyAgentExecutionCompleted(
  executionId: number,
  taskTitle: string,
  success: boolean
) {
  return createNotification({
    type: success ? "agent_execution_completed" : "agent_execution_failed",
    title: success ? "AI実行完了" : "AI実行失敗",
    message: success
      ? `「${taskTitle}」のAI実行が完了しました`
      : `「${taskTitle}」のAI実行が失敗しました`,
    link: `/tasks?taskId=${executionId}`,
    metadata: { executionId },
  });
}

/**
 * 承認リクエスト通知
 */
export async function notifyApprovalRequested(
  approvalId: number,
  title: string
) {
  return createNotification({
    type: "approval_requested",
    title: "承認リクエスト",
    message: `「${title}」の承認が必要です`,
    link: `/approvals`,
    metadata: { approvalId },
  });
}

/**
 * ポモドーロ完了通知
 */
export async function notifyPomodoroCompleted(
  taskTitle: string | null,
  completedCount: number
) {
  return createNotification({
    type: "pomodoro_completed",
    title: "ポモドーロ完了",
    message: taskTitle
      ? `「${taskTitle}」のポモドーロ #${completedCount} が完了しました`
      : `ポモドーロ #${completedCount} が完了しました`,
  });
}
