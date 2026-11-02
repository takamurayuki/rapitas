'use client';
/**
 * CalendarPersonPicker
 *
 * Whose month is on screen: mine, or someone who has shared theirs (#1270).
 *
 * Renders nothing when nobody has shared with me. An empty picker reading
 *「自分」 and offering no alternative is a control that looks broken, and
 * sharing is granted from settings, not here.
 */
import { useTranslations } from 'next-intl';
import { UserRound } from 'lucide-react';
import type { SharePerson } from '@/feature/calendar/hooks';

type Props = {
  /** People whose calendar I may see. */
  people: SharePerson[];
  /** The workspace on screen; null is my own calendar. */
  value: number | null;
  onChange: (workspaceId: number | null) => void;
};

/** The option value standing for "my own calendar". */
const MINE = 'mine';

/**
 * A select listing my calendar and every calendar shared with me.
 *
 * @param props - The people, the current selection, and the change handler / 相手一覧・現在の選択・変更ハンドラ
 */
export function CalendarPersonPicker({ people, value, onChange }: Props) {
  const t = useTranslations('calendar');

  if (people.length === 0) return null;

  return (
    <label className="flex items-center gap-2 text-sm">
      <UserRound className="w-4 h-4 text-zinc-400" aria-hidden />
      <span className="sr-only">{t('shared.pickerLabel')}</span>
      <select
        value={value === null ? MINE : String(value)}
        onChange={(e) => onChange(e.target.value === MINE ? null : Number(e.target.value))}
        aria-label={t('shared.pickerLabel')}
        className="rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-sm text-zinc-800 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
      >
        <option value={MINE}>{t('shared.myCalendar')}</option>
        {people.map((person) => (
          <option key={person.workspaceId} value={String(person.workspaceId)}>
            {person.username}
          </option>
        ))}
      </select>
    </label>
  );
}
