'use client';
/**
 * TaskCardAutoRunToggle
 *
 * Icon-button toggle on the task card for Task.autoRunExcluded — lets a user
 * keep a specific task out of auto-run selection without disabling its
 * workflow or stopping the whole theme's auto-run.
 */
import React, { useState } from 'react';
import { Bot, BotOff } from 'lucide-react';
import type { Task } from '@/types';
import { API_BASE_URL } from '@/utils/api';
import { useToast } from '@/components/ui/toast/ToastContainer';
import { useTranslations } from 'next-intl';

interface TaskCardAutoRunToggleProps {
  task: Task;
  onTaskUpdated?: () => void;
}

/**
 * Renders the auto-run inclusion/exclusion toggle button for a task card.
 *
 * @param task - Task whose autoRunExcluded flag this button toggles. / 対象タスク
 * @param onTaskUpdated - Called after a successful toggle so the caller can refresh. / 更新後コールバック
 */
export default function TaskCardAutoRunToggle({ task, onTaskUpdated }: TaskCardAutoRunToggleProps) {
  const t = useTranslations('task');
  const { showToast } = useToast();
  const [isSaving, setIsSaving] = useState(false);
  const excluded = Boolean(task.autoRunExcluded);

  const handleToggle = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isSaving) return;
    setIsSaving(true);
    try {
      const res = await fetch(`${API_BASE_URL}/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ autoRunExcluded: !excluded }),
      });
      if (res.ok) {
        await onTaskUpdated?.();
      } else {
        showToast(t('taskCard.autoRunExcludedToggleFailed'), 'error');
      }
    } catch {
      showToast(t('taskCard.autoRunExcludedToggleFailed'), 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const title = excluded ? t('taskCard.autoRunIncludeTitle') : t('taskCard.autoRunExcludeTitle');

  return (
    <button
      onClick={handleToggle}
      disabled={isSaving}
      title={title}
      aria-label={title}
      aria-pressed={excluded}
      className={`w-7 h-7 rounded-md flex items-center justify-center transition-all duration-200 ease-out hover:scale-110 disabled:opacity-50 ${
        excluded
          ? 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800'
          : 'text-zinc-400 dark:text-zinc-600 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/30'
      }`}
    >
      {excluded ? (
        <BotOff className="w-4 h-4" aria-hidden="true" />
      ) : (
        <Bot className="w-4 h-4" aria-hidden="true" />
      )}
    </button>
  );
}
