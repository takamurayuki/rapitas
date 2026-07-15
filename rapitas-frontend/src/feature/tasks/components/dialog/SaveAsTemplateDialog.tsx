'use client';

import { useState, useEffect, useRef } from 'react';
import { LayoutTemplate, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { Task, TaskTemplate } from '@/types';
import { API_BASE_URL } from '@/utils/api';
import { useFilterDataStore } from '@/stores/filter-data-store';
import { useFocusTrap } from '@/components/ui/modal/use-focus-trap';

type Props = {
  task: Task;
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (template: TaskTemplate) => void;
};

export default function SaveAsTemplateDialog({ task, isOpen, onClose, onSuccess }: Props) {
  const t = useTranslations('task');
  const tCommon = useTranslations('common');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // NOTE: The category picker was removed (2026-07-14) — the template belongs
  // to the task's current category > theme. The category NAME is resolved via
  // the filter store because the task API returns theme without its category.
  const filterThemes = useFilterDataStore((s) => s.themes);
  const filterCategories = useFilterDataStore((s) => s.categories);
  const initializeFilterData = useFilterDataStore((s) => s.initializeData);
  // The store is only guaranteed to be primed on the home page — load it here
  // so the resolved scope doesn't silently fall back to その他.
  useEffect(() => {
    if (isOpen) initializeFilterData();
  }, [isOpen, initializeFilterData]);
  const resolvedTheme = filterThemes.find((th) => th.id === task.themeId);
  const resolvedCategory =
    resolvedTheme?.categoryId != null
      ? filterCategories.find((c) => c.id === resolvedTheme.categoryId)
      : null;
  const categoryName = resolvedCategory?.name ?? task.theme?.category?.name ?? 'その他';

  useFocusTrap(panelRef, isOpen);

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Set initial values from task info when modal opens
  useEffect(() => {
    if (isOpen && task) {
      setName(task.title);
      setDescription(task.description || '');
      setError(null);
    }
  }, [isOpen, task]);

  const handleSubmit = async () => {
    if (!name.trim()) {
      setError(t('saveAsTemplateDialog.nameRequiredError'));
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const res = await fetch(`${API_BASE_URL}/templates/from-task/${task.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || undefined,
          category: categoryName,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || t('saveAsTemplateDialog.createFailedError'));
      }

      const template = await res.json();
      onSuccess?.(template);
      onClose();

      setName('');
      setDescription('');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('saveAsTemplateDialog.genericError'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    setError(null);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
      onClick={handleClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="save-as-template-dialog-title"
        tabIndex={-1}
        className="bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl border border-zinc-200 dark:border-zinc-800 w-full max-w-lg overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header — LayoutTemplate: same glyph as the テンプレート設定 menu entry. */}
        <div className="flex items-center justify-between p-5 border-b border-zinc-200 dark:border-zinc-800">
          <h2
            id="save-as-template-dialog-title"
            className="text-lg font-bold text-zinc-900 dark:text-zinc-50 flex items-center gap-2"
          >
            <LayoutTemplate className="w-5 h-5 text-violet-500" />
            {t('templateSettings')}
          </h2>
          <button
            onClick={handleClose}
            aria-label={tCommon('close')}
            className="p-2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4">
          {error && (
            <div className="p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg">
              <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
              {t('saveAsTemplateDialog.nameLabel')} <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('saveAsTemplateDialog.namePlaceholder')}
              className="w-full bg-zinc-50 dark:bg-zinc-800 rounded-xl px-4 py-2.5 text-sm border border-zinc-200 dark:border-zinc-700 outline-none focus:border-indigo-400 transition-all"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
              {tCommon('descriptionOptional')}
            </label>
            {/* rows=8: reclaim the vertical space freed by the removed category
                picker so long descriptions stay readable. */}
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('saveAsTemplateDialog.descriptionPlaceholder')}
              rows={8}
              className="w-full bg-zinc-50 dark:bg-zinc-800 rounded-xl px-4 py-2.5 text-sm border border-zinc-200 dark:border-zinc-700 outline-none focus:border-indigo-400 transition-all resize-none"
            />
          </div>

          <div className="bg-zinc-50 dark:bg-zinc-800/50 rounded-xl p-4">
            <h4 className="text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
              {t('saveAsTemplateDialog.infoHeading')}
            </h4>
            <ul className="text-sm text-zinc-500 dark:text-zinc-400 space-y-1">
              {/* Auto-assigned scope: current category > theme */}
              <li>
                • {categoryName}
                {resolvedTheme ? ` > ${resolvedTheme.name}` : ''}
              </li>
              <li>• {t('saveAsTemplateDialog.infoTitle', { title: task.title })}</li>
              <li>• {t('saveAsTemplateDialog.infoPriority', { priority: task.priority })}</li>
              {task.estimatedHours && (
                <li>
                  • {t('saveAsTemplateDialog.infoEstimatedHours', { hours: task.estimatedHours })}
                </li>
              )}
              {task.subtasks && task.subtasks.length > 0 && (
                <li>• {t('saveAsTemplateDialog.infoSubtasks', { count: task.subtasks.length })}</li>
              )}
              {task.taskLabels && task.taskLabels.length > 0 && (
                <li>• {t('saveAsTemplateDialog.infoLabels', { count: task.taskLabels.length })}</li>
              )}
            </ul>
          </div>
        </div>

        {/* Footer */}
        <div className="flex gap-3 p-5 border-t border-zinc-200 dark:border-zinc-800">
          <button
            type="button"
            onClick={handleClose}
            className="flex-1 px-4 py-2.5 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-xl transition-colors"
          >
            {tCommon('cancel')}
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="flex-1 px-4 py-2.5 text-sm font-medium text-white bg-violet-600 rounded-xl hover:bg-violet-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? tCommon('saving') : t('saveAsTemplate')}
          </button>
        </div>
      </div>
    </div>
  );
}
