'use client';
/**
 * RapiSpaceSwitcher
 *
 * The title of the conversation at the top of ラピ's panel, which opens a
 * list of the others to switch to, and the way to start a new one.
 *
 * The titles come from the server, named after each conversation's first
 * line, and the list is the mobile app's, so a conversation started on the
 * phone is here too.
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, ChevronDown, SquarePen } from 'lucide-react';
import type { RapiSpaceSummary } from './rapi-spaces-api';

interface Props {
  spaces: RapiSpaceSummary[];
  currentId: number | null;
  currentTitle: string | null;
  /** Re-read the list as it opens. / 開くときに一覧を読み直す */
  onOpenList: () => void;
  onPick: (id: number) => void;
  onNew: () => void;
}

/** `11/14 17:05`, or the time alone for today. */
function when(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const hm = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  const today = new Date();
  return d.toDateString() === today.toDateString()
    ? hm
    : `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
}

/**
 * @param props - The spaces, which is open, and how to switch
 */
export function RapiSpaceSwitcher({
  spaces,
  currentId,
  currentTitle,
  onOpenList,
  onPick,
  onNew,
}: Props) {
  const t = useTranslations('rapiAvatar.spaces');
  const [listOpen, setListOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const title = currentTitle ?? t('untitled');

  useEffect(() => {
    if (!listOpen) return;
    const onDown = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setListOpen(false);
    };
    // Escape closes the list first; the panel's own Escape closes the panel.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setListOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [listOpen]);

  const choose = (fn: () => void) => {
    setListOpen(false);
    fn();
  };

  return (
    <div ref={root} className="relative flex min-w-0 flex-1 items-center gap-1">
      <button
        type="button"
        data-rapi-space-title="true"
        aria-haspopup="listbox"
        aria-expanded={listOpen}
        title={t('switch')}
        onClick={() => {
          if (!listOpen) onOpenList();
          setListOpen((v) => !v);
        }}
        className="flex min-w-0 items-center gap-1 rounded-md px-1.5 py-1 text-sm font-medium text-zinc-800 transition-colors hover:bg-zinc-100 dark:text-zinc-100 dark:hover:bg-zinc-800"
      >
        <span className="truncate">{title}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-zinc-400" aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={onNew}
        aria-label={t('startNew')}
        title={t('startNew')}
        className="shrink-0 rounded p-1 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
      >
        <SquarePen className="h-3.5 w-3.5" aria-hidden="true" />
      </button>

      {listOpen && (
        <div
          role="listbox"
          aria-label={t('switch')}
          className="absolute top-full left-0 z-10 mt-1 max-h-72 w-72 max-w-[calc(100vw-48px)] overflow-y-auto rounded-lg border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
        >
          <button
            type="button"
            onClick={() => choose(onNew)}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-indigo-600 hover:bg-zinc-50 dark:text-indigo-400 dark:hover:bg-zinc-800"
          >
            <SquarePen className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {t('startNew')}
          </button>
          {spaces.length > 0 && (
            <div className="my-1 border-t border-zinc-100 dark:border-zinc-800" />
          )}
          {spaces.map((s) => {
            const active = s.id === currentId;
            return (
              <button
                key={s.id}
                type="button"
                role="option"
                aria-selected={active}
                data-rapi-space={s.id}
                onClick={() => choose(() => onPick(s.id))}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800 ${
                  active
                    ? 'font-medium text-zinc-900 dark:text-zinc-50'
                    : 'text-zinc-700 dark:text-zinc-300'
                }`}
              >
                <span className="w-3.5 shrink-0">
                  {active && <Check className="h-3.5 w-3.5" aria-hidden="true" />}
                </span>
                <span className="min-w-0 flex-1 truncate">{s.title ?? t('untitled')}</span>
                <span className="shrink-0 text-[11px] text-zinc-400">
                  {when(s.lastMessageAt ?? s.createdAt)}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
