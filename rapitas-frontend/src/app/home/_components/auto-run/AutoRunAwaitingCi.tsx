'use client';
/**
 * AutoRunAwaitingCi
 *
 * The progress strip's 「CI 待ち」 group: tasks that gave their slot back and
 * wait for CI / the required merge, each linking to its detail page.
 */
import Link from 'next/link';
import { ClockArrowUp } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { AwaitingCiEntry } from '@/hooks/workflow/useThemeAutoRun';

/**
 * List the CI-waiting tasks.
 *
 * @param props.entries - Tasks waiting for CI / CI待ちのタスク
 * @returns The group, or null when none waits / 一覧（0件なら null）
 */
export function AutoRunAwaitingCi({ entries }: { entries: AwaitingCiEntry[] }) {
  const t = useTranslations('autoRun');
  if (entries.length === 0) return null;
  return (
    <span
      data-testid="auto-run-awaiting-ci"
      className="inline-flex flex-wrap items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-300"
    >
      {/* ClockArrowUp = CI 待ち (ICON_POLICY). */}
      <ClockArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
      <span className="font-medium whitespace-nowrap">{t('awaitingCi.label')}</span>
      {entries.map((entry) => (
        <Link
          key={entry.taskId}
          href={`/tasks/${entry.taskId}?showHeader=true`}
          title={entry.title}
          aria-label={`#${entry.taskId} ${entry.title}`}
          className="text-indigo-600 hover:underline dark:text-indigo-400"
        >
          #{entry.taskId}
        </Link>
      ))}
    </span>
  );
}
