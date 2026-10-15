'use client';
// useTaskSubmit
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { Priority, Theme, UserSettings, WorkflowMode } from '@/types';
import { useToast } from '@/components/ui/toast/ToastContainer';
import { API_BASE_URL } from '@/utils/api';
import { getTaskDetailPath } from '@/utils/tauri';
import { createLogger } from '@/lib/logger';
import type { PendingSubtask } from './useNewTaskForm';

const logger = createLogger('useTaskSubmit');
const API_BASE = API_BASE_URL;

/** Snapshot of task field values needed to build the POST payload. */
export interface TaskPayloadValues {
  title: string;
  description: string;
  priority: Priority;
  themeId: number | null;
  selectedLabelIds: number[];
  estimatedHours: string;
  dueDate: string;
  workflowMode: WorkflowMode;
  isWorkflowModeOverride: boolean;
  /** Newline-separated goals (one per line) / 改行区切りのゴール */
  goals: string;
  /** Newline-separated constraints / 改行区切りの制約 */
  constraints: string;
  /** Newline-separated acceptance criteria / 改行区切りの受入基準 */
  acceptanceCriteria: string;
  selectedTheme: Theme | null;
  globalSettings: UserSettings | null;
}

/** Splits a newline-separated block into trimmed, non-empty items. */
function toLines(raw: string): string[] {
  return raw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

/**
 * Provides submit handlers and the isSubmitting flag.
 *
 * @param getValues - Returns current form values at call time / 呼び出し時の現在フォーム値を返す関数
 * @param getSubtasks - Returns the current pending-subtask list / 現在のサブタスクリストを返す関数
 * @returns Submit handlers and loading flag.
 */
export function useTaskSubmit(
  getValues: () => TaskPayloadValues,
  getSubtasks: () => PendingSubtask[],
) {
  const router = useRouter();
  const { showToast } = useToast();
  const t = useTranslations('task');

  const [isSubmitting, setIsSubmitting] = useState(false);

  /** POSTs all pending subtasks under the given parent task ID. */
  const createSubtasks = async (parentId: number) => {
    const subtasks = getSubtasks();
    if (subtasks.length === 0) return;
    const results = await Promise.allSettled(
      subtasks
        .filter((st) => st.title.trim())
        .map(async (st) => {
          const res = await fetch(`${API_BASE}/tasks`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              title: st.title,
              ...(st.description && { description: st.description }),
              status: 'todo',
              priority: st.priority || 'medium',
              ...(st.labels &&
                st.labels.length > 0 && {
                  labels: JSON.stringify(st.labels),
                }),
              ...(st.estimatedHours && { estimatedHours: st.estimatedHours }),
              parentId,
            }),
          });
          if (!res.ok) {
            const errorText = await res.text();
            logger.error(`[useTaskSubmit] Failed to create subtask "${st.title}":`, errorText);
          }
          return res;
        }),
    );
    const failed = results.filter((r) => r.status === 'rejected').length;
    if (failed > 0) {
      logger.warn(`[useTaskSubmit] ${failed} subtask(s) failed to create`);
    }
  };

  /** Navigates to the task detail page or home after creation. */
  const redirectAfterCreate = (createdTaskId: number, executeAfterCreate: boolean) => {
    if (executeAfterCreate) {
      showToast(t('taskCreatedAutoExecute'), 'success');
      const detailPath = getTaskDetailPath(createdTaskId);
      const separator = detailPath.includes('?') ? '&' : '?';
      router.push(`${detailPath}${separator}autoExecute=true&showHeader=true`);
    } else {
      // Offer one-tap execution from the toast: the default path used to
      // require re-opening the task and pressing 実行 (2 extra steps). Reuses
      // the same autoExecute mechanism as the auto-execute setting.
      const detailPath = getTaskDetailPath(createdTaskId);
      const separator = detailPath.includes('?') ? '&' : '?';
      showToast(t('taskCreated'), 'success', {
        action: {
          label: t('startExecution'),
          onClick: () => router.push(`${detailPath}${separator}autoExecute=true&showHeader=true`),
        },
      });
      router.push('/');
    }
  };

  /**
   * Submits the form using a title already produced by AI.
   *
   * @param generatedTitle - Pre-generated title / AI生成タイトル
   */
  const handleSubmitWithTitle = async (generatedTitle: string) => {
    if (isSubmitting || !generatedTitle.trim()) return;
    const v = getValues();
    const executeAfterCreate =
      (v.globalSettings?.autoExecuteAfterCreate ?? false) &&
      v.selectedTheme?.isDevelopment === true;
    setIsSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: generatedTitle,
          description: v.description || undefined,
          status: 'todo',
          priority: v.priority,
          themeId: v.themeId || undefined,
          labelIds: v.selectedLabelIds.length > 0 ? v.selectedLabelIds : undefined,
          estimatedHours: v.estimatedHours ? parseFloat(v.estimatedHours) : undefined,
          dueDate: v.dueDate || undefined,
          workflowMode: v.workflowMode,
          workflowModeOverride: v.isWorkflowModeOverride,
          goals: toLines(v.goals),
          constraints: toLines(v.constraints),
          acceptanceCriteria: toLines(v.acceptanceCriteria),
        }),
      });
      if (!res.ok) throw new Error(t('createFailed'));
      const createdTask = await res.json();
      await createSubtasks(createdTask.id);
      redirectAfterCreate(createdTask.id, executeAfterCreate);
    } catch (e) {
      logger.error(e);
      showToast(t('taskCreateFailed'), 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  /**
   * Standard form submit handler (title comes from form state).
   *
   * @param e - Optional form event / フォームイベント（省略可）
   */
  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const v = getValues();
    if (isSubmitting || !v.title.trim()) return;
    const executeAfterCreate =
      (v.globalSettings?.autoExecuteAfterCreate ?? false) &&
      v.selectedTheme?.isDevelopment === true;
    setIsSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: v.title,
          description: v.description || undefined,
          status: 'todo',
          priority: v.priority,
          themeId: v.themeId || undefined,
          labelIds: v.selectedLabelIds.length > 0 ? v.selectedLabelIds : undefined,
          estimatedHours: v.estimatedHours ? parseFloat(v.estimatedHours) : undefined,
          dueDate: v.dueDate || undefined,
          workflowMode: v.workflowMode,
          workflowModeOverride: v.isWorkflowModeOverride,
          goals: toLines(v.goals),
          constraints: toLines(v.constraints),
          acceptanceCriteria: toLines(v.acceptanceCriteria),
        }),
      });
      if (!res.ok) throw new Error(t('createFailed'));
      const createdTask = await res.json();
      await createSubtasks(createdTask.id);
      redirectAfterCreate(createdTask.id, executeAfterCreate);
    } catch (e) {
      logger.error(e);
      showToast(t('taskCreateFailed'), 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  return { isSubmitting, handleSubmit, handleSubmitWithTitle };
}
