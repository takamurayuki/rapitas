'use client';
/**
 * TaskDetailQuickNav
 *
 * Sticky toolbar for the task detail: section quick-jump chips (left, plus the
 * page-mode back button) and the task actions — time tracking + overflow menu —
 * right-aligned. It is the first element in the scroll area, so it sits directly
 * below the header in both the slide panel and the full-page view.
 */
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ArrowLeft, Copy, FileStack, Trash2, type LucideIcon } from 'lucide-react';
import type { Task } from '@/types';
import DropdownMenu from '@/components/ui/dropdown/DropdownMenu';
import TaskPomodoroButton from './TaskPomodoroButton';

/** One jumpable section. The id must match the section element's id. */
export interface QuickNavSection {
  id: string;
  label: string;
  icon: LucideIcon;
}

interface PomodoroState {
  isTimerRunning: boolean;
  taskId?: number | null;
}

interface TaskDetailQuickNavProps {
  sections: QuickNavSection[];
  task: Task;
  isPageMode: boolean;
  isThisTaskTimer: boolean;
  pomodoroState: PomodoroState;
  onBack: () => void;
  onOpenPomodoro: () => void;
  onDuplicateTask: () => void;
  onDeleteTask: () => void;
  onOpenSaveTemplate: () => void;
}

/**
 * Sticky section-jump + actions toolbar for the task detail.
 *
 * @param props - See {@link TaskDetailQuickNavProps}
 */
export function TaskDetailQuickNav({
  sections,
  task,
  isPageMode,
  isThisTaskTimer,
  pomodoroState,
  onBack,
  onOpenPomodoro,
  onDuplicateTask,
  onDeleteTask,
  onOpenSaveTemplate,
}: TaskDetailQuickNavProps) {
  const t = useTranslations('task');
  const tc = useTranslations('common');

  // Scroll-spy: highlight the chip for the section currently at the top.
  const [activeId, setActiveId] = useState<string | null>(null);
  const sectionIds = sections.map((s) => s.id).join(',');

  useEffect(() => {
    const els = sectionIds
      .split(',')
      .filter(Boolean)
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);
    if (els.length === 0) return;

    // Observe against the nearest scrollable ancestor (panel content or page scroller).
    let root: HTMLElement | null = els[0].parentElement;
    while (root) {
      const overflowY = getComputedStyle(root).overflowY;
      if ((overflowY === 'auto' || overflowY === 'scroll') && root.scrollHeight > root.clientHeight) {
        break;
      }
      root = root.parentElement;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActiveId(visible[0].target.id);
      },
      { root, rootMargin: '-48px 0px -65% 0px', threshold: 0 },
    );
    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [sectionIds]);

  const jumpTo = (id: string) =>
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return (
    <div className="sticky top-0 z-10 border-b border-zinc-200 bg-white/95 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/95">
      <div className="mx-auto flex max-w-4xl items-center justify-between gap-2 px-3 py-1.5 sm:px-4 md:px-6">
        <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto scrollbar-thin">
          {isPageMode && (
            <button
              type="button"
              onClick={onBack}
              aria-label={tc('back')}
              title={tc('back')}
              className="flex shrink-0 items-center rounded-full p-1 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
          )}
          {sections.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => jumpTo(id)}
              title={label}
              aria-current={activeId === id ? 'true' : undefined}
              className={`flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                activeId === id
                  ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300'
                  : 'text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <TaskPomodoroButton
            taskTitle={task.title}
            isThisTaskTimer={isThisTaskTimer}
            pomodoroState={
              pomodoroState as Parameters<typeof TaskPomodoroButton>[0]['pomodoroState']
            }
            onClick={onOpenPomodoro}
          />
          <DropdownMenu
            variant="ghost"
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
    </div>
  );
}
