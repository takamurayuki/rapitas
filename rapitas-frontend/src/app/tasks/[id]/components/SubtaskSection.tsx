'use client';
import type { Task, Priority } from '@/types';
import TaskStatusChange from '@/feature/tasks/components/TaskStatusChange';
import {
  statusConfig as sharedStatusConfig,
  renderStatusIcon,
} from '@/feature/tasks/config/StatusConfig';
import {
  CheckCircle2,
  Circle,
  Trash2,
  Check,
  X,
  Pencil,
  CheckSquare,
  Square,
  Bot,
  Clock,
  Tag,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Minus,
  Plus,
} from 'lucide-react';
import {
  SubtaskTitleIndicator,
  type ParallelExecutionStatus,
} from '@/feature/tasks/components/SubtaskExecutionStatus';
import PriorityIcon from '@/feature/tasks/components/PriorityIcon';
import { useTranslations } from 'next-intl';
import { getLabelsArray, hasLabels } from '@/utils/labels';

interface SubtaskSectionProps {
  subtasks: NonNullable<Task['subtasks']>;
  isSubtaskSelectionMode: boolean;
  selectedSubtaskIds: Set<number>;
  showSubtaskDeleteConfirm: 'all' | 'selected' | null;
  editingSubtaskId: number | null;
  editingSubtaskTitle: string;
  editingSubtaskDescription: string;
  editingSubtaskPriority: Priority;
  editingSubtaskLabels: string;
  editingSubtaskEstimatedHours: string;
  isParallelExecutionRunning: boolean;
  getSubtaskStatus: (subtaskId: number) => ParallelExecutionStatus | undefined;
  onToggleSelectionMode: () => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onToggleSubtaskSelection: (id: number) => void;
  onSetDeleteConfirm: (v: 'all' | 'selected' | null) => void;
  onDeleteAll: () => void;
  onDeleteSelected: () => void;
  onStartEditingSubtask: (
    subtask: NonNullable<Task['subtasks']>[number],
  ) => void;
  onSetEditingSubtaskTitle: (v: string) => void;
  onSetEditingSubtaskDescription: (v: string) => void;
  onSetEditingSubtaskPriority: (v: Priority) => void;
  onSetEditingSubtaskLabels: (v: string) => void;
  onSetEditingSubtaskEstimatedHours: (v: string) => void;
  onSaveSubtaskEdit: () => void;
  onCancelEditingSubtask: () => void;
  onUpdateStatus: (id: number, status: string) => void;
  // Adding subtask
  isAddingSubtask: boolean;
  newSubtaskTitle: string;
  newSubtaskDescription: string;
  newSubtaskLabels: string;
  newSubtaskEstimatedHours: string;
  onToggleAddSubtask: () => void;
  onSetNewSubtaskTitle: (v: string) => void;
  onSetNewSubtaskDescription: (v: string) => void;
  onSetNewSubtaskLabels: (v: string) => void;
  onSetNewSubtaskEstimatedHours: (v: string) => void;
  onAddSubtask: () => void;
  onCancelAddSubtask: () => void;
}

const priorityOptions: {
  value: Priority;
  icon: React.ReactNode;
  color: string;
  activeBg: string;
  activeBorder: string;
}[] = [
  {
    value: 'low',
    icon: <ArrowDown className="w-3.5 h-3.5" />,
    color: 'text-blue-500',
    activeBg: 'bg-blue-50 dark:bg-blue-900/30',
    activeBorder: 'border-blue-400 dark:border-blue-500',
  },
  {
    value: 'medium',
    icon: <Minus className="w-3.5 h-3.5" />,
    color: 'text-yellow-500',
    activeBg: 'bg-yellow-50 dark:bg-yellow-900/30',
    activeBorder: 'border-yellow-400 dark:border-yellow-500',
  },
  {
    value: 'high',
    icon: <ArrowUp className="w-3.5 h-3.5" />,
    color: 'text-orange-500',
    activeBg: 'bg-orange-50 dark:bg-orange-900/30',
    activeBorder: 'border-orange-400 dark:border-orange-500',
  },
  {
    value: 'urgent',
    icon: <AlertTriangle className="w-3.5 h-3.5" />,
    color: 'text-red-500',
    activeBg: 'bg-red-50 dark:bg-red-900/30',
    activeBorder: 'border-red-400 dark:border-red-500',
  },
];

export default function SubtaskSection({
  subtasks,
  isSubtaskSelectionMode,
  selectedSubtaskIds,
  showSubtaskDeleteConfirm,
  editingSubtaskId,
  editingSubtaskTitle,
  editingSubtaskDescription,
  editingSubtaskPriority,
  editingSubtaskLabels,
  editingSubtaskEstimatedHours,
  isParallelExecutionRunning,
  getSubtaskStatus,
  onToggleSelectionMode,
  onSelectAll,
  onDeselectAll,
  onToggleSubtaskSelection,
  onSetDeleteConfirm,
  onDeleteAll,
  onDeleteSelected,
  onStartEditingSubtask,
  onSetEditingSubtaskTitle,
  onSetEditingSubtaskDescription,
  onSetEditingSubtaskPriority,
  onSetEditingSubtaskLabels,
  onSetEditingSubtaskEstimatedHours,
  onSaveSubtaskEdit,
  onCancelEditingSubtask,
  onUpdateStatus,
  isAddingSubtask,
  newSubtaskTitle,
  newSubtaskDescription,
  newSubtaskLabels,
  newSubtaskEstimatedHours,
  onToggleAddSubtask,
  onSetNewSubtaskTitle,
  onSetNewSubtaskDescription,
  onSetNewSubtaskLabels,
  onSetNewSubtaskEstimatedHours,
  onAddSubtask,
  onCancelAddSubtask,
}: SubtaskSectionProps) {
  const t = useTranslations('task');
  const tc = useTranslations('common');
  const doneCount = subtasks.filter((s) => s.status === 'done').length;
  const hasSubtasks = subtasks.length > 0;
  const progressPercent = hasSubtasks
    ? Math.round((doneCount / subtasks.length) * 100)
    : 0;

  return (
    <div className="bg-white dark:bg-indigo-dark-900 rounded-2xl shadow-xl border border-zinc-200/50 dark:border-zinc-800 overflow-hidden mb-6">
      {/* Header */}
      <div className="p-4 border-b border-zinc-100 dark:border-zinc-800">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-zinc-900 dark:text-zinc-50 flex-1">
            <CheckCircle2 className="w-5 h-5 text-emerald-500" />
            <h2 className="text-lg font-bold">{t('subtasks')}</h2>
            {hasSubtasks ? (
              <>
                <span className="ml-1 px-2 py-0.5 text-xs font-medium bg-emerald-100 dark:bg-emerald-900/50 text-emerald-600 dark:text-emerald-400 rounded-full">
                  {doneCount}/{subtasks.length}
                </span>
                {/* Progress bar */}
                <div className="hidden sm:flex items-center gap-2 ml-2">
                  <div className="w-24 h-1.5 bg-zinc-200 dark:bg-zinc-700 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-emerald-500 transition-all duration-300"
                      style={{ width: `${progressPercent}%` }}
                    />
                  </div>
                  <span className="text-xs text-zinc-500">
                    {progressPercent}%
                  </span>
                </div>
              </>
            ) : (
              <>
                <span className="ml-1 px-2 py-0.5 text-xs font-medium bg-zinc-100 dark:bg-zinc-800 text-zinc-400 dark:text-zinc-500 rounded-full">
                  0
                </span>
                <div className="hidden sm:flex items-center gap-2 ml-2">
                  <div className="w-24 h-1.5 bg-zinc-200 dark:bg-zinc-700 rounded-full overflow-hidden" />
                </div>
              </>
            )}
          </div>
          {/* Action buttons */}
          <div className="flex items-center gap-2">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleAddSubtask();
              }}
              className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/30 rounded-lg transition-colors"
              title={t('addSubtask')}
            >
              <Plus className="w-3.5 h-3.5" />
              {t('addSubtask')}
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleSelectionMode();
              }}
              className={`flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-lg transition-colors ${
                isSubtaskSelectionMode
                  ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                  : 'text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800'
              }`}
            >
              {isSubtaskSelectionMode ? (
                <>
                  <X className="w-3.5 h-3.5" />
                  {t('deselect')}
                </>
              ) : (
                <>
                  <CheckSquare className="w-3.5 h-3.5" />
                  {t('select')}
                </>
              )}
            </button>
            {isSubtaskSelectionMode && (
              <>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (selectedSubtaskIds.size === subtasks.length) {
                      onDeselectAll();
                    } else {
                      onSelectAll();
                    }
                  }}
                  className="px-2 py-1 text-xs font-medium text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
                >
                  {selectedSubtaskIds.size === subtasks.length
                    ? t('deselectAll')
                    : t('selectAll')}
                </button>
                {selectedSubtaskIds.size > 0 && (
                  <div className="relative overflow-hidden border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 shadow-sm transition-all duration-300 hover:border-red-500 dark:hover:border-red-400">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onSetDeleteConfirm('selected');
                      }}
                      className="flex items-center gap-2 text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 transition-all cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                      <span className="font-mono text-xs font-black tracking-tight">
                        {t('deleteCount', { count: selectedSubtaskIds.size })}
                      </span>
                    </button>
                  </div>
                )}
              </>
            )}
            {!isSubtaskSelectionMode && (
              <div className="relative overflow-hidden border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 shadow-sm transition-all duration-300 hover:border-red-500 dark:hover:border-red-400">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onSetDeleteConfirm('all');
                  }}
                  className="flex items-center gap-2 text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 transition-all cursor-pointer"
                >
                  <Trash2 className="w-4 h-4" />
                  <span className="font-mono text-xs font-black tracking-tight">
                    {t('deleteAll')}
                  </span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Delete confirmation */}
      {showSubtaskDeleteConfirm && (
        <div className="p-4 bg-red-50 dark:bg-red-950/30 border-b border-red-200 dark:border-red-800">
          <p className="text-sm text-red-700 dark:text-red-300 mb-3">
            {showSubtaskDeleteConfirm === 'all'
              ? t('deleteAllConfirm', { count: subtasks.length })
              : t('deleteSelectedConfirm', { count: selectedSubtaskIds.size })}
          </p>
          <div className="flex gap-2">
            <div className="relative overflow-hidden border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 shadow-sm transition-all duration-300 hover:border-red-500 dark:hover:border-red-400">
              <button
                onClick={
                  showSubtaskDeleteConfirm === 'all'
                    ? onDeleteAll
                    : onDeleteSelected
                }
                className="flex items-center gap-2 text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 transition-all cursor-pointer"
              >
                <Trash2 className="w-4 h-4" />
                <span className="font-mono text-xs font-black tracking-tight">
                  {t('confirmDelete')}
                </span>
              </button>
            </div>
            <div className="relative overflow-hidden border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 shadow-sm transition-all duration-300 hover:border-gray-500 dark:hover:border-gray-400">
              <button
                onClick={() => onSetDeleteConfirm(null)}
                className="flex items-center gap-2 text-gray-600 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition-all cursor-pointer"
              >
                <X className="w-4 h-4" />
                <span className="font-mono text-xs font-black tracking-tight">
                  {tc('cancel')}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add subtask form */}
      {isAddingSubtask && (
        <div className="p-4 border-b border-zinc-100 dark:border-zinc-800 bg-emerald-50/30 dark:bg-emerald-950/20">
          <div className="space-y-4">
            {/* Title */}
            <div>
              <input
                type="text"
                className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-indigo-dark-900 px-3 py-2 text-sm font-medium shadow-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 dark:focus:ring-emerald-400"
                value={newSubtaskTitle}
                onChange={(e) => onSetNewSubtaskTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newSubtaskTitle.trim()) {
                    onAddSubtask();
                  } else if (e.key === 'Escape') {
                    onCancelAddSubtask();
                  }
                }}
                placeholder={t('addSubtaskPlaceholder')}
                autoFocus
              />
            </div>

            {/* Description */}
            <div>
              <textarea
                className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-indigo-dark-900 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 dark:focus:ring-emerald-400"
                value={newSubtaskDescription}
                onChange={(e) => onSetNewSubtaskDescription(e.target.value)}
                placeholder={t('subtaskDescriptionPlaceholder')}
                rows={3}
              />
            </div>

            {/* Estimated Hours + Labels row */}
            <div className="flex flex-col sm:flex-row gap-3">
              {/* Estimated hours */}
              <div className="w-full sm:w-36">
                <label className="flex items-center gap-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1.5">
                  <Clock className="w-3.5 h-3.5" />
                  {t('subtaskEstimatedHours')}
                </label>
                <input
                  type="number"
                  step="0.5"
                  min="0"
                  className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-indigo-dark-900 px-3 py-1.5 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 dark:focus:ring-emerald-400"
                  placeholder="0"
                  value={newSubtaskEstimatedHours}
                  onChange={(e) =>
                    onSetNewSubtaskEstimatedHours(e.target.value)
                  }
                />
              </div>

              {/* Labels */}
              <div className="flex-1">
                <label className="flex items-center gap-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1.5">
                  <Tag className="w-3.5 h-3.5" />
                  {t('subtaskLabels')}
                </label>
                <input
                  type="text"
                  className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-indigo-dark-900 px-3 py-1.5 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 dark:focus:ring-emerald-400"
                  placeholder={t('labelsCommaSeparated')}
                  value={newSubtaskLabels}
                  onChange={(e) => onSetNewSubtaskLabels(e.target.value)}
                />
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-2 pt-1">
              <div
                className={`relative overflow-hidden border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 shadow-sm transition-all duration-300 ${!newSubtaskTitle.trim() ? 'opacity-50 cursor-not-allowed' : 'hover:border-emerald-500 dark:hover:border-emerald-400'}`}
              >
                <button
                  onClick={onAddSubtask}
                  disabled={!newSubtaskTitle.trim()}
                  className={`flex items-center gap-2 transition-all ${!newSubtaskTitle.trim() ? 'cursor-not-allowed text-gray-400 dark:text-gray-600' : 'text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 cursor-pointer'}`}
                >
                  <Check className="w-4 h-4" />
                  <span className="font-mono text-xs font-black tracking-tight">
                    {tc('save')}
                  </span>
                </button>
              </div>
              <div className="relative overflow-hidden border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 shadow-sm transition-all duration-300 hover:border-gray-500 dark:hover:border-gray-400">
                <button
                  onClick={onCancelAddSubtask}
                  className="flex items-center gap-2 text-gray-600 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition-all cursor-pointer"
                >
                  <X className="w-4 h-4" />
                  <span className="font-mono text-xs font-black tracking-tight">
                    {tc('cancel')}
                  </span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Subtask list */}
      <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {subtasks.map((subtask) => (
          <div
            key={subtask.id}
            className={`transition-colors ${
              isSubtaskSelectionMode && selectedSubtaskIds.has(subtask.id)
                ? 'bg-blue-50 dark:bg-blue-950/20 ring-1 ring-blue-500 dark:ring-blue-400'
                : ''
            }`}
          >
            {editingSubtaskId === subtask.id ? (
              /* Expanded edit panel */
              <div className="p-4 bg-zinc-50/50 dark:bg-zinc-800/20">
                <div className="space-y-4">
                  {/* Title */}
                  <div>
                    <input
                      type="text"
                      className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-indigo-dark-900 px-3 py-2 text-sm font-medium shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      value={editingSubtaskTitle}
                      onChange={(e) => onSetEditingSubtaskTitle(e.target.value)}
                      placeholder={t('subtaskTitle')}
                      autoFocus
                    />
                  </div>

                  {/* Description */}
                  <div>
                    <textarea
                      className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-indigo-dark-900 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      value={editingSubtaskDescription}
                      onChange={(e) =>
                        onSetEditingSubtaskDescription(e.target.value)
                      }
                      placeholder={t('descriptionMarkdown')}
                      rows={3}
                    />
                  </div>

                  {/* Priority + Estimated Hours row */}
                  <div className="flex flex-col sm:flex-row gap-3">
                    {/* Priority selector */}
                    <div className="flex-1">
                      <label className="flex items-center gap-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1.5">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        {t('subtaskPriority')}
                      </label>
                      <div className="flex gap-1">
                        {priorityOptions.map((opt) => {
                          const isSelected =
                            editingSubtaskPriority === opt.value;
                          return (
                            <button
                              key={opt.value}
                              type="button"
                              onClick={() =>
                                onSetEditingSubtaskPriority(opt.value)
                              }
                              className={`flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                                isSelected
                                  ? `${opt.activeBorder} ${opt.color} ${opt.activeBg}`
                                  : 'border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 hover:border-zinc-400 dark:hover:border-zinc-500'
                              }`}
                            >
                              <span className={isSelected ? opt.color : ''}>
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

                    {/* Estimated hours */}
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
                        onChange={(e) =>
                          onSetEditingSubtaskEstimatedHours(e.target.value)
                        }
                      />
                    </div>
                  </div>

                  {/* Labels */}
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
                      onChange={(e) =>
                        onSetEditingSubtaskLabels(e.target.value)
                      }
                    />
                  </div>

                  {/* Action buttons */}
                  <div className="flex items-center gap-2 pt-1">
                    <div
                      className={`relative overflow-hidden border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 shadow-sm transition-all duration-300 ${!editingSubtaskTitle.trim() ? 'opacity-50 cursor-not-allowed' : 'hover:border-green-500 dark:hover:border-green-400'}`}
                    >
                      <button
                        onClick={onSaveSubtaskEdit}
                        disabled={!editingSubtaskTitle.trim()}
                        className={`flex items-center gap-2 transition-all ${!editingSubtaskTitle.trim() ? 'cursor-not-allowed text-gray-400 dark:text-gray-600' : 'text-green-600 dark:text-green-400 hover:text-green-700 dark:hover:text-green-300 cursor-pointer'}`}
                      >
                        <Check className="w-4 h-4" />
                        <span className="font-mono text-xs font-black tracking-tight">
                          {tc('save')}
                        </span>
                      </button>
                    </div>
                    <div className="relative overflow-hidden border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 shadow-sm transition-all duration-300 hover:border-gray-500 dark:hover:border-gray-400">
                      <button
                        onClick={onCancelEditingSubtask}
                        className="flex items-center gap-2 text-gray-600 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition-all cursor-pointer"
                      >
                        <X className="w-4 h-4" />
                        <span className="font-mono text-xs font-black tracking-tight">
                          {tc('cancel')}
                        </span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              /* View mode */
              <div className="p-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/30">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    {isSubtaskSelectionMode && (
                      <button
                        onClick={() => onToggleSubtaskSelection(subtask.id)}
                        className="shrink-0"
                      >
                        {selectedSubtaskIds.has(subtask.id) ? (
                          <CheckSquare className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                        ) : (
                          <Square className="w-5 h-5 text-zinc-400" />
                        )}
                      </button>
                    )}
                    {!isSubtaskSelectionMode &&
                    isParallelExecutionRunning &&
                    getSubtaskStatus(subtask.id) ? (
                      <SubtaskTitleIndicator
                        executionStatus={getSubtaskStatus(subtask.id)}
                        size="sm"
                      />
                    ) : (
                      !isSubtaskSelectionMode && (
                        <div className="shrink-0">
                          {subtask.status === 'done' ? (
                            <div className="w-5 h-5 rounded-full bg-emerald-100 dark:bg-emerald-900/50 flex items-center justify-center">
                              <Check className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                            </div>
                          ) : subtask.status === 'in-progress' ? (
                            <div className="relative w-5 h-5 rounded-md bg-blue-100 dark:bg-blue-900/50 flex items-center justify-center text-blue-600 dark:text-blue-400">
                              <svg
                                className="absolute -inset-0.5 w-[calc(100%+4px)] h-[calc(100%+4px)] pointer-events-none"
                                viewBox="0 0 32 32"
                                fill="none"
                              >
                                <rect
                                  x="1"
                                  y="1"
                                  width="30"
                                  height="30"
                                  rx="7"
                                  stroke="#3b82f6"
                                  strokeWidth="2"
                                  strokeDasharray="20 87.96"
                                  strokeLinecap="round"
                                  fill="none"
                                  style={{
                                    animation:
                                      'icon-outer-border-spin 1.5s linear infinite',
                                    willChange: 'stroke-dashoffset',
                                    transform: 'translateZ(0)',
                                  }}
                                />
                              </svg>
                              <Circle className="w-3 h-3" />
                            </div>
                          ) : (
                            <div className="w-5 h-5 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center">
                              <Circle className="w-3 h-3 text-zinc-400" />
                            </div>
                          )}
                        </div>
                      )
                    )}
                    <span
                      className={`text-sm truncate ${subtask.status === 'done' ? 'text-zinc-400 line-through' : 'text-zinc-900 dark:text-zinc-50'}`}
                    >
                      {subtask.title}
                    </span>
                    <PriorityIcon priority={subtask.priority} size="sm" />
                    {subtask.agentGenerated && (
                      <span className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400 rounded shrink-0">
                        <Bot className="w-3 h-3" />
                        AI
                      </span>
                    )}
                    {/* Inline metadata badges */}
                    {hasLabels(subtask.labels) && (
                      <div className="hidden sm:flex gap-1 shrink-0">
                        {getLabelsArray(subtask.labels)
                          .slice(0, 2)
                          .map((label, idx) => (
                            <span
                              key={idx}
                              className="text-[10px] px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-300"
                            >
                              {label}
                            </span>
                          ))}
                        {getLabelsArray(subtask.labels).length > 2 && (
                          <span className="text-[10px] px-1 py-0.5 text-zinc-400">
                            +{getLabelsArray(subtask.labels).length - 2}
                          </span>
                        )}
                      </div>
                    )}
                    {subtask.estimatedHours && (
                      <span className="hidden sm:inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-orange-100 text-orange-700 dark:bg-orange-900/50 dark:text-orange-300 shrink-0">
                        <Clock className="w-2.5 h-2.5" />
                        {subtask.estimatedHours}h
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {(['todo', 'in-progress', 'done'] as const).map(
                      (status) => {
                        const config = sharedStatusConfig[status];
                        return (
                          <TaskStatusChange
                            key={status}
                            status={status}
                            currentStatus={subtask.status}
                            config={config}
                            renderIcon={renderStatusIcon}
                            onClick={(newStatus) =>
                              onUpdateStatus(subtask.id, newStatus)
                            }
                            size="sm"
                          />
                        );
                      },
                    )}
                    <div className="relative overflow-hidden border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 shadow-sm transition-all duration-300 hover:border-blue-500 dark:hover:border-blue-400">
                      <button
                        onClick={() => onStartEditingSubtask(subtask)}
                        className="flex items-center justify-center text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-all cursor-pointer"
                        title={t('subtaskDetails')}
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
