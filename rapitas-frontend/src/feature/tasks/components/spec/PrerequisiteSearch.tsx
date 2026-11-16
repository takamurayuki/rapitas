'use client';
/**
 * PrerequisiteSearch
 *
 * Finds a task to wait for by its title or its number ("#12"), so nobody has
 * to look task numbers up before typing them. Leaves out the task itself and
 * those already added. Not responsible for saving the choice.
 */
import { useEffect, useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Search } from 'lucide-react';
import { API_BASE_URL } from '@/utils/api';

/** A task offered as a prerequisite. */
export interface PrerequisiteCandidate {
  id: number;
  title: string;
  status: string;
}

const SEARCH_DELAY_MS = 250;

async function findCandidates(query: string): Promise<PrerequisiteCandidate[]> {
  const number = /^#?(\d+)$/.exec(query);
  if (number) {
    const res = await fetch(`${API_BASE_URL}/tasks/${number[1]}`);
    if (!res.ok) return [];
    const task = (await res.json()) as PrerequisiteCandidate;
    return task?.id ? [task] : [];
  }
  const res = await fetch(`${API_BASE_URL}/tasks/search?q=${encodeURIComponent(query)}&limit=8`);
  if (!res.ok) return [];
  return (await res.json()) as PrerequisiteCandidate[];
}

/**
 * @param props.excludeIds - The task itself and those already added / 除外するタスク
 * @param props.onPick - Called with the task picked / 選んだときに呼ぶ
 * @param props.disabled - While a save is in flight / 保存中
 */
export function PrerequisiteSearch({
  excludeIds,
  onPick,
  disabled,
}: {
  excludeIds: number[];
  onPick: (task: PrerequisiteCandidate) => void;
  disabled?: boolean;
}) {
  const t = useTranslations('task');
  const listId = useId();
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<PrerequisiteCandidate[] | null>(null);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setFound(null);
      return;
    }
    let live = true;
    const timer = setTimeout(() => {
      findCandidates(q)
        .then((list) => live && setFound(list))
        .catch(() => live && setFound([]));
    }, SEARCH_DELAY_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query]);

  const options = (found ?? []).filter((c) => !excludeIds.includes(c.id));
  const pick = (c: PrerequisiteCandidate) => {
    setQuery('');
    setFound(null);
    onPick(c);
  };

  return (
    <div className="relative">
      <div className="flex items-center gap-2 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg px-3 py-1.5 border border-transparent focus-within:border-indigo-400/60">
        <Search className="w-3.5 h-3.5 text-zinc-400" aria-hidden="true" />
        <input
          role="combobox"
          aria-expanded={found !== null}
          aria-controls={listId}
          aria-label={t('prerequisitesSearch')}
          placeholder={t('prerequisitesSearch')}
          value={query}
          disabled={disabled}
          onChange={(e) => setQuery(e.target.value)}
          className="flex-1 bg-transparent text-sm outline-none placeholder:text-zinc-400"
        />
      </div>
      {found !== null && (
        <div
          id={listId}
          role="listbox"
          className="absolute z-10 mt-1 w-full max-h-60 overflow-auto rounded-lg border border-zinc-200 bg-white py-1 dark:border-zinc-700 dark:bg-zinc-900"
        >
          {options.length === 0 ? (
            <p className="px-3 py-1.5 text-xs text-zinc-500">{t('prerequisitesNoMatch')}</p>
          ) : (
            options.map((c) => (
              <button
                key={c.id}
                type="button"
                role="option"
                aria-selected={false}
                onClick={() => pick(c)}
                className="w-full text-left px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 focus:bg-zinc-50 outline-none dark:text-zinc-200 dark:hover:bg-zinc-800 dark:focus:bg-zinc-800"
              >
                <span className="mr-2 text-xs text-zinc-400">#{c.id}</span>
                {c.title}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
