'use client';
/**
 * AutoRunTaskSelect
 *
 * A chevron followed by the shown task's id as a link. The chevron opens a
 * wide menu right under the link, listing every running task as "#id title"
 * with the shown one highlighted; picking one switches which task the strip
 * shows. Replaces the wide <select> so the strip keeps its height
 * (2026-11-27 requests).
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
 * @returns The chevron, the id link and the task menu / 切り替えとIDリンク
 */
export function AutoRunTaskSelect({ tasks, shown, onSelect }: Props) {
  const t = useTranslations('autoRun');
  return (
    <span data-testid="auto-run-task-select" className="inline-flex shrink-0 items-center gap-0.5">
      <DropdownMenu
        variant="ghost"
        align="left"
        triggerLabel={t('progress.selectTask')}
        menuLabel={t('progress.selectTask')}
        // ChevronDown = open this list (a disclosure), not a new concept.
        triggerIcon={<ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />}
        triggerClassName="!px-0.5 !py-0 !rounded"
        // A wide, short rectangle: one line per task, long titles truncated.
        menuClassName="!mt-1 w-[30rem] max-w-[90vw]"
        items={tasks.map((a) => ({
          selected: a.id === shown.id,
          label: (
            <span className="flex min-w-0 items-baseline gap-2" title={a.title}>
              <span className="shrink-0">#{a.id}</span>
              <span className="truncate font-normal">{a.title}</span>
            </span>
          ),
          onClick: () => onSelect(a.id),
        }))}
      />
      {/* NOTE: The strip itself shows only the id (asked 2026-11-21); titles
          appear in the menu, and here stay in title / aria-label. */}
      <Link
        href={`/tasks/${shown.id}?showHeader=true`}
        title={shown.title}
        aria-label={`#${shown.id} ${shown.title}`}
        className="text-indigo-600 hover:underline dark:text-indigo-400"
      >
        #{shown.id}
      </Link>
    </span>
  );
}
