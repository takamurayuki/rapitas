/**
 * TaskDetailHeader
 *
 * Renders the top action bar of the task detail page. Shows a back button
 * in page mode, and either edit/dropdown controls (view mode) or save/cancel
 * controls (edit mode). Not responsible for any business logic — all actions
 * are passed in as callbacks.
 */

'use client';
import {
  Save,
  Copy,
  Pencil,
  X,
  FileStack,
  Trash2,
  ArrowLeft,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import DropdownMenu from '@/components/ui/dropdown/DropdownMenu';
import TaskPomodoroButton from './TaskPomodoroButton';
import type { Task } from '@/types';

interface PomodoroState {
  isTimerRunning: boolean;
  taskId?: number | null;
}

export interface TaskDetailHeaderProps {
  /** Current task — used for title display in pomodoro button. */
  task: Task;
  isEditing: boolean;
  isPageMode: boolean;
  isThisTaskTimer: boolean;
  pomodoroState: PomodoroState;
  onBack: () => void;
  onStartEditing: () => void;
  onSaveTask: () => void;
  onCancelEditing: () => void;
  onDuplicateTask: () => void;
  onDeleteTask: () => void;
  onOpenSaveTemplate: () => void;
  onOpenPomodoro: () => void;
}

/**
 * Action bar at the top of the task detail page.
 *
 * @param props - Mode flags, task data, and action callbacks.
 */
export default function TaskDetailHeader({
  task,
  isEditing,
  isPageMode,
  isThisTaskTimer,
  pomodoroState,
  onBack,
  onStartEditing,
  onSaveTask,
  onCancelEditing,
  onDuplicateTask,
  onDeleteTask,
  onOpenSaveTemplate,
  onOpenPomodoro,
}: TaskDetailHeaderProps) {
  const t = useTranslations('task');
  const tc = useTranslations('common');

  return (
    <div className="mb-6 flex items-center justify-between gap-2">
      <div>
        {isPageMode && (
          <button
            onClick={onBack}
            className="flex items-center gap-2 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
            <span className="text-sm font-medium">{tc('back')}</span>
          </button>
        )}
      </div>

      <div className="flex items-center gap-2">
        {!isEditing && (
          <TaskPomodoroButton
            taskTitle={task.title}
            isThisTaskTimer={isThisTaskTimer}
            pomodoroState={
              pomodoroState as Parameters<
                typeof TaskPomodoroButton
              >[0]['pomodoroState']
            }
            onClick={onOpenPomodoro}
          />
        )}

        {!isEditing ? (
          <>
            <div className="relative overflow-hidden border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 shadow-sm transition-all duration-300 hover:border-blue-500 dark:hover:border-blue-400">
              <button
                onClick={onStartEditing}
                className="flex items-center gap-2 text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-all cursor-pointer"
              >
                <Pencil className="w-4 h-4" />
                <span className="font-mono text-xs font-black tracking-tight">
                  {tc('edit')}
                </span>
              </button>
            </div>
            <DropdownMenu
              items={[
                {
                  label: t('duplicateTask'),
                  icon: <Copy className="w-4 h-4" />,
                  onClick: onDuplicateTask,
                },
                {
                  label: t('saveAsTemplate'),
                  icon: <FileStack className="w-4 h-4" />,
                  onClick: onOpenSaveTemplate,
                },
                {
                  label: tc('delete'),
                  icon: <Trash2 className="w-4 h-4" />,
                  onClick: onDeleteTask,
                  variant: 'danger',
                },
              ]}
            />
          </>
        ) : (
          <>
            <div className="relative overflow-hidden border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 shadow-sm transition-all duration-300 hover:border-green-500 dark:hover:border-green-400">
              <button
                onClick={onSaveTask}
                className="flex items-center gap-2 text-green-600 dark:text-green-400 hover:text-green-700 dark:hover:text-green-300 transition-all cursor-pointer"
              >
                <Save className="w-4 h-4" />
                <span className="font-mono text-xs font-black tracking-tight">
                  {tc('save')}
                </span>
              </button>
            </div>
            <div className="relative overflow-hidden border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 shadow-sm transition-all duration-300 hover:border-gray-500 dark:hover:border-gray-400">
              <button
                onClick={onCancelEditing}
                className="flex items-center gap-2 text-gray-600 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition-all cursor-pointer"
              >
                <X className="w-4 h-4" />
                <span className="font-mono text-xs font-black tracking-tight">
                  {tc('cancel')}
                </span>
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
