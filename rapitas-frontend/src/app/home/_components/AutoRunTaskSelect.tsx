'use client';
/**
 * AutoRunTaskSelect
 *
 * The shown task's id as a link, with a small chevron next to it that opens a
 * menu of the other running tasks. Picking one switches which task the
 * auto-run strip shows. Replaces the wide <select> (2026-11-27 request: keep
 * the strip's height, combine the link and the picker, ids only).
 */
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ChevronDown } from 'lucide-react';
import DropdownMenu from '@/components/ui/dropdown/DropdownMenu';
import type { ActiveTask } from '@/hooks/workflow/useThemeAutoRun';

interface Props {
  tasks: ActiveTask[];
  /** The task shown now. / 表示中のタスク */
  shown: { id: number; title: string };
  onSelect: (id: number) => void;
}

/**
 * @param props.tasks - Running tasks, head first / 動作中のタスク
 * @param props.shown - Shown task / 表示中のタスク
 * @param props.onSelect - Called with the picked id / 選択時
 * @returns The id link and its task menu / IDリンクと切り替えメニュー
 */
export function AutoRunTaskSelect({ tasks, shown, onSelect }: Props) {
  const t = useTranslations('autoRun');
  const others = tasks.filter((a) => a.id !== shown.id);
  return (
    <span data-testid="auto-run-task-select" className="inline-flex shrink-0 items-center">
      {/* NOTE: Only the id shows (asked 2026-11-21, again 2026-11-27); the title
          stays in title / aria-label for hover and screen readers. */}
      <Link
        href={`/tasks/${shown.id}?showHeader=true`}
        title={shown.title}
        aria-label={`#${shown.id} ${shown.title}`}
        className="text-indigo-600 hover:underline dark:text-indigo-400"
      >
        #{shown.id}
      </Link>
      <DropdownMenu
        variant="ghost"
        align="left"
        triggerLabel={t('progress.selectTask')}
        menuLabel={t('progress.selectTask')}
        // ChevronDown = open this list (a disclosure), not a new concept.
        triggerIcon={<ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />}
        triggerClassName="!px-0.5 !py-0 !rounded"
        menuClassName="!min-w-0 !mt-1"
        items={others.map((a) => ({
          label: `#${a.id}`,
          onClick: () => onSelect(a.id),
        }))}
      />
    </span>
  );
}
