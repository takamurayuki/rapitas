'use client';
/**
 * RapiHistory
 *
 * What has been asked in this session, so you can get back to it.
 *
 * Switching tabs no longer throws a mode's contents away, but that only
 * covers the last thing each mode did — ask for two roadmaps and the first
 * is gone. This is the other half: the sentences themselves, newest first,
 * each a way back to where it went.
 *
 * One scrolling row, and only when there is something in it. The panel is
 * 320px wide and the tab bar was just cut from two rows to one; spending
 * that back on an empty history would undo the point.
 */
import { useTranslations } from 'next-intl';
import { MODE_ICONS, type PanelMode } from './rapi-modes';

/** One thing that was asked, and where it went. */
export interface AskedFor {
  text: string;
  intent: PanelMode;
}

interface Props {
  /** Newest first. / 新しい順 */
  history: AskedFor[];
  onPick: (entry: AskedFor) => void;
}

/**
 * @param props - What was asked this session, and how to go back to one
 */
export function RapiHistory({ history, onPick }: Props) {
  const ta = useTranslations('rapiAvatar');
  const tm = useTranslations('rapiAvatar.mode');
  if (history.length === 0) return null;

  return (
    <div
      className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-zinc-200 px-2 py-1 dark:border-zinc-700"
      aria-label={ta('history')}
    >
      {history.map((entry, i) => {
        const Icon = MODE_ICONS[entry.intent];
        return (
          <button
            // Index as well as text: the same sentence can be asked twice,
            // and two chips keying on it alone would collapse into one.
            key={`${i}-${entry.text}`}
            type="button"
            onClick={() => onPick(entry)}
            title={`${tm(entry.intent)} — ${entry.text}`}
            className="flex max-w-[11rem] shrink-0 items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] text-zinc-600 transition-colors hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
          >
            <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
            <span className="truncate">{entry.text}</span>
          </button>
        );
      })}
    </div>
  );
}
