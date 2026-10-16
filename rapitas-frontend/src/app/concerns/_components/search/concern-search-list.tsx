'use client';

/**
 * ConcernSearchList
 *
 * Accessible listbox of search hits with a roving tabindex: Tab enters the list,
 * arrow keys / Home / End move focus, Enter selects. Each option carries a
 * screen-reader label built from the scored fields. NOT responsible for fetching.
 */
import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { ConcernPriority, ConcernSearchItem } from './concern-search.types';
import { formatSpoken } from './concern-search-utils';

const PRIORITY_BADGE: Record<ConcernPriority, string> = {
  Critical: 'bg-rose-50 text-rose-600 dark:bg-rose-900/30 dark:text-rose-300',
  High: 'bg-orange-50 text-orange-600 dark:bg-orange-900/30 dark:text-orange-300',
  Medium: 'bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-300',
  Low: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300',
};

interface ConcernSearchListProps {
  items: ConcernSearchItem[];
  onSelect?: (item: ConcernSearchItem) => void;
}

/**
 * Renders search hits as a keyboard-navigable listbox.
 *
 * @param props - Items to render and an optional selection callback / 表示アイテムと選択コールバック
 */
export function ConcernSearchList({ items, onSelect }: ConcernSearchListProps) {
  const t = useTranslations('concerns');
  const [activeIndex, setActiveIndex] = useState(0);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const refs = useRef<(HTMLDivElement | null)[]>([]);

  const active = Math.min(activeIndex, Math.max(items.length - 1, 0));

  const moveTo = (index: number) => {
    const next = Math.max(0, Math.min(items.length - 1, index));
    setActiveIndex(next);
    refs.current[next]?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent, index: number, item: ConcernSearchItem) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        moveTo(index + 1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        moveTo(index - 1);
        break;
      case 'Home':
        e.preventDefault();
        moveTo(0);
        break;
      case 'End':
        e.preventDefault();
        moveTo(items.length - 1);
        break;
      case 'Enter':
        e.preventDefault();
        setSelectedId(item.id);
        onSelect?.(item);
        break;
    }
  };

  if (items.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-zinc-500 dark:text-zinc-400">
        {t('search.noResults')}
      </p>
    );
  }

  return (
    <div role="listbox" aria-label={t('search.listLabel')} className="flex flex-col gap-2">
      {items.map((item, index) => (
        <div
          key={item.id}
          ref={(el) => {
            refs.current[index] = el;
          }}
          role="option"
          aria-selected={selectedId === item.id}
          aria-label={`${formatSpoken(t, item)}、${item.title}`}
          tabIndex={index === active ? 0 : -1}
          onFocus={() => setActiveIndex(index)}
          onKeyDown={(e) => onKeyDown(e, index, item)}
          className="flex items-center gap-3 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 aria-selected:border-indigo-400 dark:border-zinc-700 dark:bg-zinc-900"
        >
          <span aria-hidden="true" className="font-mono text-xs">
            {item.pattern}
          </span>
          <span
            aria-hidden="true"
            className="min-w-0 flex-1 truncate text-zinc-800 dark:text-zinc-100"
          >
            {item.title}
          </span>
          <span
            aria-hidden="true"
            className={`rounded px-1.5 py-0.5 text-xs font-medium ${PRIORITY_BADGE[item.priority]}`}
          >
            {item.priority}
          </span>
          <span
            aria-hidden="true"
            className="text-xs tabular-nums text-zinc-500 dark:text-zinc-400"
          >
            {item.impactScore.toFixed(1)}
          </span>
        </div>
      ))}
    </div>
  );
}
