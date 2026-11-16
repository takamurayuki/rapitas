'use client';
/**
 * ThemePicker
 *
 * One button naming the chosen "category › theme" that opens a category → theme
 * tree. Replaces flat walls of theme chips, which were unreadable (10px text,
 * user-chosen fill colours) and unscannable at ~40 themes.
 * Not responsible for loading themes or filtering them by app mode.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Check, ChevronDown, ChevronRight } from 'lucide-react';
import type { Category, Theme } from '@/types';
import { groupThemesByCategory } from './group-themes';

interface ThemePickerProps {
  /** Themes the user may pick. / 選択対象のテーマ */
  themes: Theme[];
  /** Categories used to group the themes. / グループ化に使うカテゴリ */
  categories: Category[];
  /** Selected theme id; null means none (or "all" when `allLabel` is set). / 選択中のテーマID */
  value: number | null;
  /** Called with the picked theme, or null for "all". / 選択時のコールバック */
  onChange: (theme: Theme | null) => void;
  /** When set, offers an "all" choice with this label (filters, not forms). / 「すべて」の表示名 */
  allLabel?: string;
  /** Accessible name for the button and panel. / ボタンとパネルのラベル */
  label?: string;
  className?: string;
}

/**
 * Category → theme picker.
 *
 * @param props - See ThemePickerProps / プロパティ
 * @returns The picker / ピッカー
 */
export function ThemePicker({
  themes,
  categories,
  value,
  onChange,
  allLabel,
  label,
  className = '',
}: ThemePickerProps) {
  const t = useTranslations('themePicker');
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<number | null>>(new Set());
  const rootRef = useRef<HTMLDivElement>(null);

  const groups = useMemo(() => groupThemesByCategory(themes, categories), [themes, categories]);
  const selected = themes.find((th) => th.id === value) ?? null;
  const selectedGroup = groups.find((g) => g.themes.some((th) => th.id === value));
  const groupName = (category: Category | null) => category?.name ?? t('uncategorized');

  const openPanel = () => {
    // Start on the selected theme's category; a single category needs no click.
    const start = groups.length === 1 ? groups[0] : selectedGroup;
    setExpanded(new Set(start ? [start.category?.id ?? null] : []));
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [open]);

  const pick = (theme: Theme | null) => {
    onChange(theme);
    setOpen(false);
  };

  const toggleGroup = (key: number | null) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const optionClass = (isSelected: boolean) =>
    `flex w-full min-h-10 items-center gap-2.5 rounded-md pl-8 pr-3 text-left text-sm transition-colors ${
      isSelected
        ? 'bg-indigo-50 text-indigo-700 font-medium dark:bg-indigo-950/40 dark:text-indigo-300'
        : 'text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800'
    }`;

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        onClick={() => (open ? setOpen(false) : openPanel())}
        className="flex min-h-10 w-full max-w-full items-center gap-2 rounded-lg border border-zinc-300 bg-white px-3 text-sm text-zinc-800 transition-colors hover:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:border-zinc-500"
      >
        {selected ? (
          <>
            {/* User-chosen colours appear only as a dot, never as a fill behind text. */}
            <span
              aria-hidden="true"
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: selected.color }}
            />
            <span className="min-w-0 truncate">
              {selectedGroup && (
                <span className="text-zinc-500 dark:text-zinc-400">
                  {groupName(selectedGroup.category)}
                  <span aria-hidden="true" className="mx-1">
                    ›
                  </span>
                </span>
              )}
              {selected.name}
            </span>
          </>
        ) : (
          <span className="min-w-0 truncate text-zinc-500 dark:text-zinc-400">
            {allLabel ?? t('placeholder')}
          </span>
        )}
        <ChevronDown aria-hidden="true" className="ml-auto h-4 w-4 shrink-0 text-zinc-500" />
      </button>

      {open && (
        // Anchored right: in a right-hand form column a left-anchored panel ran off a phone screen.
        <div className="absolute right-0 top-full z-50 mt-1 w-80 min-w-full max-w-[calc(100vw-2rem)] rounded-xl border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
          <div
            role="listbox"
            aria-label={label ?? t('title')}
            className="max-h-96 overflow-y-auto p-1.5"
          >
            {allLabel && (
              <button
                type="button"
                role="option"
                aria-selected={value === null}
                onClick={() => pick(null)}
                className={`${optionClass(value === null)} pl-3`}
              >
                {allLabel}
              </button>
            )}
            {groups.map((group) => {
              const key = group.category?.id ?? null;
              const isOpen = expanded.has(key);
              return (
                <div key={key ?? 'none'}>
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    onClick={() => toggleGroup(key)}
                    className="flex w-full min-h-10 items-center gap-2 rounded-md px-2 text-left text-sm font-medium text-zinc-800 hover:bg-zinc-100 dark:text-zinc-100 dark:hover:bg-zinc-800"
                  >
                    <ChevronRight
                      aria-hidden="true"
                      className={`h-4 w-4 shrink-0 text-zinc-500 transition-transform ${isOpen ? 'rotate-90' : ''}`}
                    />
                    <span className="min-w-0 flex-1 truncate">{groupName(group.category)}</span>
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">
                      {group.themes.length}
                    </span>
                  </button>
                  {isOpen &&
                    group.themes.map((theme) => {
                      const isSelected = theme.id === value;
                      return (
                        <button
                          key={theme.id}
                          type="button"
                          role="option"
                          aria-selected={isSelected}
                          onClick={() => pick(theme)}
                          className={optionClass(isSelected)}
                        >
                          <span
                            aria-hidden="true"
                            className="h-2.5 w-2.5 shrink-0 rounded-full"
                            style={{ backgroundColor: theme.color }}
                          />
                          <span className="min-w-0 flex-1 truncate">{theme.name}</span>
                          {isSelected && <Check aria-hidden="true" className="h-4 w-4 shrink-0" />}
                        </button>
                      );
                    })}
                </div>
              );
            })}
          </div>
          <div className="border-t border-zinc-200 px-3 py-2 dark:border-zinc-700">
            <Link
              href="/themes"
              className="text-xs text-indigo-600 hover:underline dark:text-indigo-400"
            >
              {t('manage')}
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
