'use client';
// TaskDetailHeader
import { Copy, FileStack, Trash2, ArrowLeft } from 'lucide-react';
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
  isPageMode: boolean;
  isThisTaskTimer: boolean;
  pomodoroState: PomodoroState;
  onBack: () => void;
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
  isPageMode,
  isThisTaskTimer,
  pomodoroState,
  onBack,
  onDuplicateTask,
  onDeleteTask,
  onOpenSaveTemplate,
  onOpenPomodoro,
}: TaskDetailHeaderProps) {
  const t = useTranslations('task');
  const tc = useTranslations('common');

  return (
    <div className="mb-3 flex items-center justify-between gap-2">
      <div>
        {isPageMode && (
          <button
            onClick={onBack}
            aria-label="戻る"
            className="flex items-center gap-2 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
            <span className="text-sm font-medium">{tc('back')}</span>
          </button>
        )}
      </div>

      <div className="flex items-center gap-2">
        <TaskPomodoroButton
          taskTitle={task.title}
          isThisTaskTimer={isThisTaskTimer}
          pomodoroState={
            pomodoroState as Parameters<typeof TaskPomodoroButton>[0]['pomodoroState']
          }
          onClick={onOpenPomodoro}
        />

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
      </div>
    </div>
  );
}
