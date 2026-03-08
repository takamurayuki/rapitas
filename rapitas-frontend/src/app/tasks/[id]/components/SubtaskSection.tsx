'use client';
import type { Task } from '@/types';
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
  ChevronDown,
  ChevronUp,
  Pencil,
  CheckSquare,
  Square,
  Bot,
} from 'lucide-react';
import { SubtaskTitleIndicator, type ParallelExecutionStatus } from '@/feature/tasks/components/SubtaskExecutionStatus';
import PriorityIcon from '@/feature/tasks/components/PriorityIcon';
import { useTranslations } from 'next-intl';

interface SubtaskSectionProps {
  subtasks: NonNullable<Task['subtasks']>;
  isExpanded: boolean;
  onToggleExpand: () => void;
  isSubtaskSelectionMode: boolean;
  selectedSubtaskIds: Set<number>;
  showSubtaskDeleteConfirm: 'all' | 'selected' | null;
  editingSubtaskId: number | null;
  editingSubtaskTitle: string;
  editingSubtaskDescription: string;
  isParallelExecutionRunning: boolean;
  getSubtaskStatus: (subtaskId: number) => ParallelExecutionStatus | undefined;
  onToggleSelectionMode: () => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onToggleSubtaskSelection: (id: number) => void;
  onSetDeleteConfirm: (v: 'all' | 'selected' | null) => void;
  onDeleteAll: () => void;
  onDeleteSelected: () => void;
  onStartEditingSubtask: (subtask: NonNullable<Task['subtasks']>[number]) => void;
  onSetEditingSubtaskTitle: (v: string) => void;
  onSetEditingSubtaskDescription: (v: string) => void;
  onSaveSubtaskEdit: () => void;
  onCancelEditingSubtask: () => void;
  onUpdateStatus: (id: number, status: string) => void;
}

export default function SubtaskSection({
  subtasks,
  isExpanded,
  onToggleExpand,
  isSubtaskSelectionMode,
  selectedSubtaskIds,
  showSubtaskDeleteConfirm,
  editingSubtaskId,
  editingSubtaskTitle,
  editingSubtaskDescription,
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
  onSaveSubtaskEdit,
  onCancelEditingSubtask,
  onUpdateStatus,
}: SubtaskSectionProps) {
  const t = useTranslations('task');
  const tc = useTranslations('common');
  const doneCount = subtasks.filter((s) => s.status === 'done').length;
  const progressPercent = Math.round((doneCount / subtasks.length) * 100);

  return (
    <div className="bg-white dark:bg-indigo-dark-900 rounded-2xl shadow-xl border border-zinc-200/50 dark:border-zinc-800 overflow-hidden mb-6">
      {/* Header */}
      <div className="p-4 border-b border-zinc-100 dark:border-zinc-800">
        <div className="flex items-center justify-between">
          <div
            className="flex items-center gap-2 text-zinc-900 dark:text-zinc-50 cursor-pointer flex-1"
            onClick={onToggleExpand}
          >
            <CheckCircle2 className="w-5 h-5 text-emerald-500" />
            <h2 className="text-lg font-bold">{t('subtasks')}</h2>
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
              <span className="text-xs text-zinc-500">{progressPercent}%</span>
            </div>
          </div>
          {/* Action buttons */}
          <div className="flex items-center gap-2">
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
                    selectedSubtaskIds.size === subtasks.length
                      ? onDeselectAll()
                      : onSelectAll();
                  }}
                  className="px-2 py-1 text-xs font-medium text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
                >
                  {selectedSubtaskIds.size === subtasks.length ? t('deselectAll') : t('selectAll')}
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
            <button
              onClick={onToggleExpand}
              className="p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded transition-colors"
            >
              {isExpanded ? (
                <ChevronUp className="w-5 h-5 text-zinc-400" />
              ) : (
                <ChevronDown className="w-5 h-5 text-zinc-400" />
              )}
            </button>
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
                onClick={showSubtaskDeleteConfirm === 'all' ? onDeleteAll : onDeleteSelected}
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

      {/* Subtask list */}
      {isExpanded && (
        <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {subtasks.map((subtask) => (
            <div
              key={subtask.id}
              className={`p-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/30 transition-colors ${
                isSubtaskSelectionMode && selectedSubtaskIds.has(subtask.id)
                  ? 'bg-blue-50 dark:bg-blue-950/20 ring-1 ring-blue-500 dark:ring-blue-400'
                  : ''
              }`}
            >
              {editingSubtaskId === subtask.id ? (
                /* Edit mode */
                <div className="space-y-3">
                  <input
                    type="text"
                    className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-indigo-dark-900 px-3 py-2 text-sm font-medium shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={editingSubtaskTitle}
                    onChange={(e) => onSetEditingSubtaskTitle(e.target.value)}
                    placeholder={t('subtaskTitle')}
                    autoFocus
                  />
                  <textarea
                    className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-indigo-dark-900 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={editingSubtaskDescription}
                    onChange={(e) => onSetEditingSubtaskDescription(e.target.value)}
                    placeholder={t('descriptionMarkdown')}
                    rows={3}
                  />
                  <div className="flex items-center gap-2">
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
              ) : (
                /* View mode */
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
                            <div className="w-5 h-5 rounded-full bg-blue-100 dark:bg-blue-900/50 flex items-center justify-center">
                              <Circle className="w-3 h-3 text-blue-600 dark:text-blue-400 animate-pulse" />
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
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {(['todo', 'in-progress', 'done'] as const).map((status) => {
                      const config = sharedStatusConfig[status];
                      return (
                        <TaskStatusChange
                          key={status}
                          status={status}
                          currentStatus={subtask.status}
                          config={config}
                          renderIcon={renderStatusIcon}
                          onClick={(newStatus) => onUpdateStatus(subtask.id, newStatus)}
                          size="sm"
                        />
                      );
                    })}
                    <div className="relative overflow-hidden border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 shadow-sm transition-all duration-300 hover:border-blue-500 dark:hover:border-blue-400">
                      <button
                        onClick={() => onStartEditingSubtask(subtask)}
                        className="flex items-center justify-center text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-all cursor-pointer"
                        title={tc('edit')}
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
