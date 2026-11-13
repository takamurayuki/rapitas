'use client';
/**
 * UnassignedTasksPanel
 *
 * The goal's tasks that are not filed under a milestone yet, each with a
 * picker to file it under one. Hidden when there are none.
 */
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { Milestone, UnassignedTask } from '../../_hooks/goals.types';

interface UnassignedTasksPanelProps {
  tasks: UnassignedTask[];
  milestones: Milestone[];
  onFile: (taskId: number, milestoneId: number) => void;
}

/**
 * Renders the unassigned-task list.
 *
 * @param tasks - Tasks without a milestone / 節目未設定のタスク
 * @param milestones - Milestones they can be filed under / 振り分け先の節目
 * @param onFile - Files a task under a milestone / タスクを節目に入れる
 */
export function UnassignedTasksPanel({ tasks, milestones, onFile }: UnassignedTasksPanelProps) {
  const t = useTranslations('goals');
  if (tasks.length === 0) return null;
  const targets = milestones.filter((m) => m.status !== 'reached');

  return (
    <section className="rounded-xl border border-dashed border-zinc-300 p-4 dark:border-zinc-700">
      <h2 className="mb-1 text-sm font-semibold text-zinc-800 dark:text-zinc-100">
        {t('unassigned.title', { count: tasks.length })}
      </h2>
      <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">{t('unassigned.description')}</p>
      <ul className="space-y-1.5">
        {tasks.map((task) => (
          <li key={task.id} className="flex items-center gap-2 text-sm">
            <Link
              href={`/tasks/detail?id=${task.id}&showHeader=true`}
              className={`min-w-0 flex-1 truncate hover:underline ${
                task.status === 'done'
                  ? 'text-zinc-400 line-through'
                  : 'text-zinc-700 dark:text-zinc-200'
              }`}
            >
              {task.title}
            </Link>
            <select
              defaultValue=""
              disabled={targets.length === 0}
              aria-label={t('unassigned.fileLabel', { title: task.title })}
              onChange={(e) => {
                if (e.target.value) onFile(task.id, Number(e.target.value));
              }}
              className="max-w-[45%] rounded-lg border border-zinc-300 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
            >
              <option value="">{t('unassigned.pick')}</option>
              {targets.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </li>
        ))}
      </ul>
    </section>
  );
}
