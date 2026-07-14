'use client';
/**
 * TaskDetailQuickNav
 *
 * Sticky toolbar for the task detail: section quick-jump chips (left, plus the
 * page-mode back button) and the task actions — time tracking + overflow menu —
 * right-aligned. It is the first element in the scroll area, so it sits directly
 * below the header in both the slide panel and the full-page view.
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ArrowLeft, LayoutTemplate, Trash2, type LucideIcon } from 'lucide-react';
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
  onDeleteTask,
  onOpenSaveTemplate,
}: TaskDetailQuickNavProps) {
  const t = useTranslations('task');
  const tc = useTranslations('common');

  // Scroll-spy: highlight the chip for the section currently at the top.
  const [activeId, setActiveId] = useState<string | null>(null);
  // When the content fits without a scrollbar, jumping is pointless — the chips
  // are disabled and show no active state.
  const [isScrollable, setIsScrollable] = useState(true);
  const navRef = useRef<HTMLDivElement>(null);
  const sectionIds = sections.map((s) => s.id).join(',');
  // While a chip-triggered scroll is animating, the click optimistically owns the
  // active state so a short section (e.g. workflow) isn't overridden back by the
  // observer when it can't reach the top.
  const programmaticUntilRef = useRef(0);

  useEffect(() => {
    const els = sectionIds
      .split(',')
      .filter(Boolean)
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);
    if (els.length === 0) return;

    // Resolve the scroll container deterministically via its marker, not by
    // walking up computed overflow-y: in page mode the container only gains
    // `overflow-auto` once content is ready, so an overflow-based search runs too
    // early and wrongly falls back to the document (which never scrolls in page
    // mode). closest() is timing-independent. Null → viewport fallback.
    const root = (navRef.current?.closest('[data-task-scroll-container]') ??
      null) as HTMLElement | null;

    const observer = new IntersectionObserver(
      (entries) => {
        // A recent chip click owns the active state — don't override it.
        if (Date.now() < programmaticUntilRef.current) return;
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

  // Track whether the scroll container actually overflows. Re-measured whenever
  // the content grows/shrinks (subtasks load, workflow expands, window resize).
  useEffect(() => {
    // Same deterministic resolution as the scroll-spy — avoid the overflow-walk
    // that mis-resolved to the document in page mode and left chips disabled.
    const scroller = (navRef.current?.closest('[data-task-scroll-container]') ??
      null) as HTMLElement | null;
    const measure = () => {
      const el = scroller ?? document.documentElement;
      // +1 tolerates sub-pixel rounding that would otherwise read as scrollable.
      setIsScrollable(el.scrollHeight > el.clientHeight + 1);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    let rafId: number;
    // NOTE: RAF defers setState to the next frame, preventing the ResizeObserver
    // loop warning when the scrollable-state change triggers a re-render that
    // alters the observed element's dimensions.
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(measure);
    });
    // Observe the growing inner content (nav's sibling) so we re-measure as
    // sections load asynchronously, plus the scroller itself for resize.
    const growEl = navRef.current?.nextElementSibling ?? null;
    if (growEl) ro.observe(growEl);
    if (scroller) ro.observe(scroller);
    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
    };
  }, [sectionIds]);

  const jumpTo = (id: string) => {
    setActiveId(id); // optimistic: the pressed chip is active immediately
    programmaticUntilRef.current = Date.now() + 800;
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div
      ref={navRef}
      className="sticky top-0 z-10 border-b border-zinc-200 bg-white/95 dark:border-zinc-800 dark:bg-zinc-900/95"
    >
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
          {sections.map(({ id, label, icon: Icon }) => {
            const isActive = isScrollable && activeId === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => jumpTo(id)}
                disabled={!isScrollable}
                title={label}
                aria-current={isActive ? 'true' : undefined}
                className={`flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                  !isScrollable
                    ? 'cursor-default text-zinc-500 opacity-60 dark:text-zinc-500'
                    : isActive
                      ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300'
                      : 'text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            );
          })}
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
                // NOTE: 複製は削除 (2026-07-14 要望)。テンプレート設定から
                // テンプレート適用で代替できる。
                label: t('templateSettings'),
                icon: <LayoutTemplate className="w-4 h-4" />,
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
