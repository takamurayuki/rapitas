'use client';

/**
 * SubtaskEditForm
 *
 * Expanded inline edit panel for a single subtask.
 * Rendered in place of the subtask row when editing is active.
 */

import { Check, X, Clock, Tag, AlertTriangle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { Priority } from '@/types';
import { priorityOptions } from './types';

interface SubtaskEditFormProps {
  editingSubtaskTitle: string;
  editingSubtaskDescription: string;
  editingSubtaskPriority: Priority;
  editingSubtaskLabels: string;
  editingSubtaskEstimatedHours: string;
  onSetEditingTitle: (v: string) => void;
  onSetEditingDescription: (v: string) => void;
  onSetEditingPriority: (v: Priority) => void;
  onSetEditingLabels: (v: string) => void;
  onSetEditingEstimatedHours: (v: string) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
}

/**
 * Form panel for editing an existing subtask's title, description, priority, labels, and hours.
 *
 * @param props - SubtaskEditFormProps
 */
export function SubtaskEditForm({
  editingSubtaskTitle,
  editingSubtaskDescription,
  editingSubtaskPriority,
  editingSubtaskLabels,
  editingSubtaskEstimatedHours,
  onSetEditingTitle,
  onSetEditingDescription,
  onSetEditingPriority,
  onSetEditingLabels,
  onSetEditingEstimatedHours,
  onSaveEdit,
  onCancelEdit,
}: SubtaskEditFormProps) {
  const t = useTranslations('task');
  const tc = useTranslations('common');

  return (
    <div className="p-4 bg-zinc-50/50 dark:bg-zinc-800/20">
      <div className="space-y-4">
        <input
          type="text"
          className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-indigo-dark-900 px-3 py-2 text-sm font-medium shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          value={editingSubtaskTitle}
          onChange={(e) => onSetEditingTitle(e.target.value)}
          placeholder={t('subtaskTitle')}
          autoFocus
        />

        <textarea
          className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-indigo-dark-900 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          value={editingSubtaskDescription}
          onChange={(e) => onSetEditingDescription(e.target.value)}
          placeholder={t('descriptionMarkdown')}
          rows={3}
        />

        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex-1">
            <label className="flex items-center gap-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1.5">
              <AlertTriangle className="w-3.5 h-3.5" />
              {t('subtaskPriority')}
            </label>
            <div className="flex gap-1">
              {priorityOptions.map((opt) => {
                const isActive = editingSubtaskPriority === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => onSetEditingPriority(opt.value)}
                    className={`flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                      isActive
                        ? `${opt.activeBorder} ${opt.color} ${opt.activeBg}`
                        : 'border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 hover:border-zinc-400 dark:hover:border-zinc-500'
                    }`}
                  >
                    <span className={isActive ? opt.color : ''}>
                      {opt.icon}
                    </span>
                    {t(
                      `priority${opt.value.charAt(0).toUpperCase() + opt.value.slice(1)}` as
                        | 'priorityLow'
                        | 'priorityMedium'
                        | 'priorityHigh'
                        | 'priorityCritical'
                        | 'priorityUrgent',
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="w-full sm:w-36">
            <label className="flex items-center gap-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1.5">
              <Clock className="w-3.5 h-3.5" />
              {t('subtaskEstimatedHours')}
            </label>
            <input
              type="number"
              step="0.5"
              min="0"
              className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-indigo-dark-900 px-3 py-1.5 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="0"
              value={editingSubtaskEstimatedHours}
              onChange={(e) => onSetEditingEstimatedHours(e.target.value)}
            />
          </div>
        </div>

        <div>
          <label className="flex items-center gap-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1.5">
            <Tag className="w-3.5 h-3.5" />
            {t('subtaskLabels')}
          </label>
          <input
            type="text"
            className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-indigo-dark-900 px-3 py-1.5 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder={t('labelsCommaSeparated')}
            value={editingSubtaskLabels}
            onChange={(e) => onSetEditingLabels(e.target.value)}
          />
        </div>

        <div className="flex items-center gap-2 pt-1">
          <button
            onClick={onSaveEdit}
            disabled={!editingSubtaskTitle.trim()}
            className={`flex items-center gap-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 shadow-sm transition-all duration-300 ${
              !editingSubtaskTitle.trim()
                ? 'opacity-50 cursor-not-allowed text-gray-400 dark:text-gray-600'
                : 'hover:border-green-500 dark:hover:border-green-400 text-green-600 dark:text-green-400 hover:text-green-700 dark:hover:text-green-300 cursor-pointer'
            }`}
          >
            <Check className="w-4 h-4" />
            <span className="font-mono text-xs font-black tracking-tight">
              {tc('save')}
            </span>
          </button>
          <button
            onClick={onCancelEdit}
            className="flex items-center gap-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 shadow-sm transition-all duration-300 hover:border-gray-500 dark:hover:border-gray-400 text-gray-600 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 cursor-pointer"
          >
            <X className="w-4 h-4" />
            <span className="font-mono text-xs font-black tracking-tight">
              {tc('cancel')}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
