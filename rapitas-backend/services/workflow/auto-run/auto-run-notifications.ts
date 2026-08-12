/**
 * auto-run-notifications
 *
 * Notification records for theme auto-run lifecycle events that need USER
 * attention (approval gates, unanswered questions, failures, completion).
 * The scheduler only broadcasts SSE — invisible unless the user is watching
 * that screen — so these persist to the Notification table the header bell
 * and browser notifications read. Deduplicated: an UNREAD notification of the
 * same type for the same task/theme suppresses re-sending (the 12 s scheduler
 * tick would otherwise re-fire every pass through a held state).
 */
import { prisma } from '../../../config';
import { createLogger } from '../../../config/logger';

const log = createLogger('auto-run-notifications');

interface NotifyParams {
  type: string;
  themeId: number;
  taskId?: number;
  title: string;
  message: string;
  link?: string;
  /** Extra fields merged into the metadata JSON (core fields always win). */
  extraMetadata?: Record<string, unknown>;
}

/**
 * Create an auto-run notification unless an unread one of the same type for
 * the same task/theme already exists. Best-effort: failures are logged and
 * swallowed — a notification problem must never affect scheduling.
 *
 * @param params - Notification type, scope (theme/task), and content. / 通知内容
 */
async function notifyOnce(params: NotifyParams): Promise<void> {
  try {
    const dedupKey = `"dedupKey":"${params.type}:${params.taskId ?? `theme-${params.themeId}`}"`;
    const existing = await prisma.notification.findFirst({
      where: {
        type: params.type,
        isRead: false,
        metadata: { contains: dedupKey },
      },
      select: { id: true },
    });
    if (existing) return;

    await prisma.notification.create({
      data: {
        type: params.type,
        title: params.title,
        message: params.message,
        link: params.link ?? (params.taskId ? `/tasks/${params.taskId}` : null),
        // metadata is a JSON string; embed the dedup key as a real field so the
        // contains-match above cannot collide with other metadata content.
        // extraMetadata is spread FIRST so it can never clobber the core fields.
        metadata: JSON.stringify({
          ...params.extraMetadata,
          dedupKey: `${params.type}:${params.taskId ?? `theme-${params.themeId}`}`,
          themeId: params.themeId,
          taskId: params.taskId ?? null,
        }),
      },
    });
  } catch (err) {
    log.warn({ err, type: params.type }, '[autoRunNotify] Failed to create notification');
  }
}

/** Fetch a task title for notification copy; falls back to the id. */
async function taskLabel(taskId: number): Promise<string> {
  const task = await prisma.task
    .findUnique({ where: { id: taskId }, select: { title: true } })
    .catch(() => null);
  return task?.title ?? `タスク ${taskId}`;
}

/** Auto-run paused: a plan is waiting for the user's approval. */
export async function notifyAwaitingPlanApproval(themeId: number, taskId: number): Promise<void> {
  await notifyOnce({
    type: 'auto_run_awaiting_approval',
    themeId,
    taskId,
    title: '自動実行: 計画の承認待ち',
    message: `「${await taskLabel(taskId)}」の実装計画が承認待ちです。承認するまで自動実行は一時停止します。`,
  });
}

/** Auto-run held: the agent asked a question and is waiting for an answer. */
export async function notifyAwaitingUserAnswer(themeId: number, taskId: number): Promise<void> {
  await notifyOnce({
    type: 'auto_run_awaiting_answer',
    themeId,
    taskId,
    title: '自動実行: エージェントが回答を待っています',
    message: `「${await taskLabel(taskId)}」のエージェントが質問への回答を待っています。回答するまでこのテーマの自動実行は停止したままです。`,
  });
}

/** A task exceeded its wall-clock budget and was force-stopped by the hang backstop. */
export async function notifyHangBackstop(
  themeId: number,
  taskId: number,
  wallMinutes: number,
): Promise<void> {
  await notifyOnce({
    type: 'auto_run_hang_backstop',
    themeId,
    taskId,
    title: '自動実行: タスクが時間上限で停止しました',
    message: `タスク #${taskId}「${await taskLabel(taskId)}」が時間上限（${wallMinutes}分）を超えたため停止しました — ログを確認して再実行してください。`,
  });
}

/** A task failed/was blocked and auto-run skipped it. */
export async function notifyTaskSkipped(
  themeId: number,
  taskId: number,
  reason: string,
): Promise<void> {
  await notifyOnce({
    type: 'auto_run_task_skipped',
    themeId,
    taskId,
    title: '自動実行: タスクをスキップしました',
    message: `「${await taskLabel(taskId)}」が失敗またはブロックされたためスキップしました: ${reason}`,
  });
}

/** All tasks for the theme are done; auto-run went idle. */
export async function notifyAllDone(themeId: number): Promise<void> {
  const theme = await prisma.theme
    .findUnique({ where: { id: themeId }, select: { name: true } })
    .catch(() => null);
  await notifyOnce({
    type: 'auto_run_all_done',
    themeId,
    title: '自動実行: すべてのタスクが完了',
    message: `テーマ「${theme?.name ?? themeId}」の対象タスクをすべて処理しました。自動実行を終了します。`,
  });
}

/** One reason bucket of the value-gate exclusions shown in the satiated notification. */
export interface SatiationBreakdownEntry {
  reason: string;
  count: number;
  /** Representative excluded concern titles (a few, for human tuning). */
  examples: string[];
}

// Human-facing labels for the value gate's rejection reason codes (要求B.4 —
// the operator reads these to decide whether the gate is too strict).
const REJECT_REASON_LABELS: Record<string, string> = {
  no_evidence: '具体的証拠なし',
  below_severity: 'severityが閾値未満',
  saturated: '語彙的飽和（単一文化）',
  source_quota: '同一sourceの日次上限超過',
};

/**
 * The theme is satiated (飽和完了): two consecutive dry cycles with no
 * value-gate-passing work. Includes the exclusion breakdown so a human can
 * tell whether the gate is rejecting things it should not (要求B.4). The raw
 * breakdown also lands in metadata JSON for machine consumption.
 *
 * @param themeId - Satiated theme. / 飽和したテーマID
 * @param breakdown - Gate exclusions bucketed by reason. / 理由別の除外内訳
 */
export async function notifySatiated(
  themeId: number,
  breakdown: SatiationBreakdownEntry[],
): Promise<void> {
  const theme = await prisma.theme
    .findUnique({ where: { id: themeId }, select: { name: true } })
    .catch(() => null);
  const lines = breakdown.map((b) => {
    const label = REJECT_REASON_LABELS[b.reason] ?? b.reason;
    const example = b.examples[0] ? `（例: ${b.examples[0]}）` : '';
    return `・${label}: ${b.count}件${example}`;
  });
  const detail =
    lines.length > 0
      ? `\n価値ゲートで除外された候補:\n${lines.join('\n')}`
      : '\n除外された候補はありません（バックログ自体が空です）。';
  await notifyOnce({
    type: 'auto_run_satiated',
    themeId,
    title: '自動実行: 飽和完了（価値ある仕事を消化）',
    message: `テーマ「${theme?.name ?? themeId}」は価値ある仕事を消化しました。新しいシグナルで自動再開します。${detail}`,
    extraMetadata: { satiationBreakdown: breakdown },
  });
}
