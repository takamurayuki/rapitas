/**
 * useCompactTaskDetailActions
 *
 * PATCH-based mutation helpers used by CompactTaskDetailCard (field saves,
 * protection toggle, description-link insertion). Extracted from the card
 * component to keep it under the size limit; behavior is unchanged.
 */
'use client';
import { useTranslations } from 'next-intl';
import { type Task } from '@/types';
import { useToast } from '@/components/ui/toast/ToastContainer';
import { useTaskCacheStore } from '@/stores/task-cache-store';
import { API_BASE_URL } from '@/utils/api';
import { clearApiCache } from '@/lib/api-client';

export interface UseCompactTaskDetailActionsArgs {
  task: Task;
  onTaskUpdated?: () => void;
}

/**
 * Builds the PATCH mutation helpers shared across CompactTaskDetailCard's
 * inline-edit fields.
 *
 * @param args - the current task and the parent's refresh callback / 対象タスクと親の再取得コールバック
 * @returns patchTask/saveField/toggleProtected/insertLinkToDescription helpers / 各種更新ヘルパー
 */
export function useCompactTaskDetailActions({
  task,
  onTaskUpdated,
}: UseCompactTaskDetailActionsArgs) {
  const tCommon = useTranslations('common');
  const { showToast } = useToast();
  const updateTaskLocally = useTaskCacheStore((s) => s.updateTaskLocally);

  /**
   * Patches a set of task fields and refreshes the parent view.
   *
   * @param data - Partial task fields to update / 更新するフィールドの部分オブジェクト
   */
  const patchTask = async (data: Record<string, unknown>) => {
    try {
      const res = await fetch(`${API_BASE_URL}/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error('update failed');
      // Reflect the change instantly in the shared cache so widgets like
      // TodayTaskProgressBar update without waiting for the next poll cycle.
      updateTaskLocally(task.id, data as Partial<Task>);
      clearApiCache(`/tasks/${task.id}`);
      onTaskUpdated?.();
    } catch {
      showToast(tCommon('saveFailed'), 'error');
    }
  };

  /**
   * Persists a single inline-edited field (title/description) via PATCH, then
   * refreshes the task. Mirrors the full-edit save path.
   *
   * @param field - Field to update / 更新するフィールド
   * @param value - New value / 新しい値
   */
  const saveField = async (field: 'title' | 'description' | 'priority', value: string) => {
    await patchTask({ [field]: value });
  };

  /**
   * Toggles the task's deletion-protection flag via PATCH and refreshes the view.
   * Reuses patchTask so cache invalidation + parent refresh behave identically
   * to the inline field edits above.
   */
  const toggleProtected = async () => {
    await patchTask({ isProtected: !task.isProtected });
  };

  /**
   * Appends a markdown link to the task description and persists via PATCH.
   * Prepends a newline when there is existing content.
   *
   * @param link - Markdown link string / 挿入するMarkdownリンク
   */
  const insertLinkToDescription = async (link: string) => {
    const current = task.description ?? '';
    const next = current.trim() ? `${current}\n${link}` : link;
    await patchTask({ description: next });
  };

  /**
   * Replaces the task's full label set (PUT /tasks/:id/labels — labels have
   * their own association endpoint, not a PATCH field).
   *
   * @param labelIds - Complete set of label IDs to keep / 設定するラベルIDの全量
   */
  const updateLabels = async (labelIds: number[]) => {
    try {
      const res = await fetch(`${API_BASE_URL}/tasks/${task.id}/labels`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ labelIds }),
      });
      if (!res.ok) throw new Error('update failed');
      clearApiCache(`/tasks/${task.id}`);
      onTaskUpdated?.();
    } catch {
      showToast(tCommon('saveFailed'), 'error');
    }
  };

  return { patchTask, saveField, toggleProtected, insertLinkToDescription, updateLabels };
}
