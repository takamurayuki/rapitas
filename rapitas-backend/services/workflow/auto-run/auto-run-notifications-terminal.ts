/**
 * auto-run-notifications-terminal
 *
 * Notifications for terminal/idle auto-run states: all tasks done, wedged
 * (all blocked), and the idle-stop timer disabling auto-run (task 784). Split
 * out of auto-run-notifications.ts (task 784) to stay under the file-size
 * ratchet; auto-run-notifications.ts re-exports this as a barrel.
 */
import { prisma } from '../../../config';
import { buildNotificationI18n } from '../../communication/notification-i18n';
import { formatHeldTasks, type HeldTaskBreakdown } from './auto-run-held-tasks';
import { notifyOnce } from './auto-run-notifications-shared';

/**
 * The theme ran dry while open tasks sit outside the selector's reach
 * (workflowDisabled / autoRunExcluded / awaiting_question). Fired next to
 * notifyAllDone so a forgotten hold is visible: #911 was parked on
 * workflowDisabled as a "temporary" hold on 2026-09-10 and every dry point
 * since reported a clean all_done. Distinct type so its dedup never collides
 * with the all_done notice.
 *
 * @param themeId - Theme that went idle. / 対象テーマ
 * @param held - Held-task breakdown (total > 0). / 保留タスクの内訳
 */
export async function notifyHeldTasks(themeId: number, held: HeldTaskBreakdown): Promise<void> {
  const theme = await prisma.theme
    .findUnique({ where: { id: themeId }, select: { name: true } })
    .catch(() => null);
  const themeName = theme?.name ?? String(themeId);
  const heldList = formatHeldTasks(held);
  await notifyOnce({
    type: 'auto_run_held_tasks',
    themeId,
    title: '自動実行: 選定対象外のまま残っているタスクがあります',
    message: `テーマ「${themeName}」は選定可能なタスクを処理し終えましたが、${held.total} 件が選定対象外のまま残っています: ${heldList}。意図した保留でなければ、ワークフロー無効化・自動実行除外を解除するか質問に回答してください。`,
    i18n: buildNotificationI18n('auto_run_held_tasks', {
      themeName,
      heldCount: held.total,
      heldList,
    }),
  });
}

/**
 * The theme is WEDGED: work exists but every remaining task is blocked
 * (task 615). Deliberately a different type + copy from notifyAllDone so a
 * dead loop is never read as a normal "all finished" idle.
 *
 * @param themeId - Theme that went idle while wedged. / 対象テーマ
 * @param blockedCount - Blocked tasks remaining. / blockedタスク件数
 * @param escalatedCount - Of those, already escalated (awaiting attention). / エスカレーション済み件数
 */
export async function notifyAllBlocked(
  themeId: number,
  blockedCount: number,
  escalatedCount: number,
): Promise<void> {
  const theme = await prisma.theme
    .findUnique({ where: { id: themeId }, select: { name: true } })
    .catch(() => null);
  const themeName = theme?.name ?? String(themeId);
  await notifyOnce({
    type: 'auto_run_all_blocked',
    themeId,
    title: '自動実行: 実行可能なタスクがすべてブロックされています',
    message: `テーマ「${themeName}」は完了ではなく閉塞しています: blocked タスクが ${blockedCount} 件残っています（うち対応待ちエスカレーション ${escalatedCount} 件）。回答・分割・調査など人の対応が必要です。`,
    i18n: buildNotificationI18n('auto_run_all_blocked', {
      themeName,
      blockedCount,
      escalatedCount,
    }),
  });
}

/** All tasks for the theme are done; auto-run went idle. */
export async function notifyAllDone(themeId: number): Promise<void> {
  const theme = await prisma.theme
    .findUnique({ where: { id: themeId }, select: { name: true } })
    .catch(() => null);
  const themeName = theme?.name ?? String(themeId);
  await notifyOnce({
    type: 'auto_run_all_done',
    themeId,
    title: '自動実行: すべてのタスクが完了',
    message: `テーマ「${themeName}」の対象タスクをすべて処理しました。自動実行を終了します。`,
    i18n: buildNotificationI18n('auto_run_all_done', { themeName }),
  });
}

/**
 * The idle-stop timer expired (task 784): the theme ran dry and no new task
 * was filed within idleStopMinutes, so auto-run was disabled. Distinct from
 * notifyAllDone (which fires at the dry point, while the theme is still armed).
 *
 * @param themeId - Theme whose auto-run was stopped. / 停止したテーマ
 */
export async function notifyIdleStopped(themeId: number): Promise<void> {
  const theme = await prisma.theme
    .findUnique({ where: { id: themeId }, select: { name: true } })
    .catch(() => null);
  const themeName = theme?.name ?? String(themeId);
  await notifyOnce({
    type: 'auto_run_idle_stopped',
    themeId,
    title: '自動実行: 新規起票がないため停止しました',
    message: `テーマ「${themeName}」はタスクが枯渇し、新規の起票がなかったため自動実行を停止しました。手動でタスクを起票するか、夜間の自己補充ウィンドウが開くと再開できます。`,
    i18n: buildNotificationI18n('auto_run_idle_stopped', { themeName }),
  });
}
