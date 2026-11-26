'use client';
/**
 * AutoRunTaskSelect
 *
 * Dropdown choosing which running task the auto-run strip shows.
 */
import { useTranslations } from 'next-intl';
import { Select } from '@/components/ui/select';
import type { ActiveTask } from '@/hooks/workflow/useThemeAutoRun';

const MAX_TITLE = 40;

interface Props {
  tasks: ActiveTask[];
  selectedId: number | null;
  onSelect: (id: number) => void;
}

/**
 * @param props.tasks - Running tasks, head first / 動作中のタスク
 * @param props.selectedId - Shown task id / 表示中のID
 * @param props.onSelect - Called with the picked id / 選択時
 * @returns The select element / プルダウン
 */
export function AutoRunTaskSelect({ tasks, selectedId, onSelect }: Props) {
  const t = useTranslations('autoRun');
  return (
    <Select
      aria-label={t('progress.selectTask')}
      value={selectedId ?? ''}
      onChange={(e) => onSelect(Number(e.target.value))}
      className="h-7 w-auto max-w-[16rem] shrink-0 px-2 py-0 text-xs"
    >
      {tasks.map((a) => (
        <option key={a.id} value={a.id} title={a.title}>
          #{a.id} {a.title.length > MAX_TITLE ? a.title.slice(0, MAX_TITLE) + '…' : a.title}
        </option>
      ))}
    </Select>
  );
}
