'use client';

/**
 * TaskCaptureForm
 *
 * Task mode of the quick-capture popup. Two-row target picker — categories on
 * top, that category's themes below, each chip showing its own icon + color +
 * name — then title (Enter saves) + optional description (Ctrl+Enter saves).
 * A theme is required (tasks always belong to one); the last-used theme is
 * remembered. Saving keeps the window open for back-to-back entry.
 */
import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import { useTranslations } from 'next-intl';
import { FolderKanban } from 'lucide-react';
import { API_BASE_URL } from '@/utils/api';
import { getIconComponent } from '@/components/category/icon-data';
import { CaptureStatusBar } from './capture-status-bar';
import type { CaptureStatus } from './capture-window';

const LAST_THEME_KEY = 'rapitas-quick-capture-theme';

interface ThemeOption {
  id: number;
  name: string;
  color: string | null;
  icon: string | null;
}

interface CategoryOption extends ThemeOption {
  themes: ThemeOption[];
}

interface TaskCaptureFormProps {
  /** Shared with the page's blur-to-hide guard. / blur時非表示の抑止フラグ。 */
  savingRef: MutableRefObject<boolean>;
}

/** One category/theme chip: its own icon + color + name; tinted when active. */
function TargetChip({
  item,
  active,
  onClick,
}: {
  item: ThemeOption;
  active: boolean;
  onClick: () => void;
}) {
  const Icon = getIconComponent(item.icon || '') || FolderKanban;
  const color = item.color || '#71717a';
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-colors ${
        active
          ? ''
          : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200'
      }`}
      // Identity color: the icon always wears it; the active chip adds a
      // low-alpha tint of the same color so the selection reads instantly.
      style={active ? { backgroundColor: `${color}2b`, color } : undefined}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" style={{ color }} />
      {item.name}
    </button>
  );
}

/**
 * Render the task capture fields.
 *
 * @param props - Shared saving flag. / 保存中フラグ。
 */
export function TaskCaptureForm({ savingRef }: TaskCaptureFormProps) {
  const t = useTranslations('quickCapture');
  const [categories, setCategories] = useState<CategoryOption[] | null>(null);
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [themeId, setThemeId] = useState<number | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<CaptureStatus>('idle');
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/categories`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const list = ((await res.json()) as CategoryOption[]).filter(
          (c) => (c.themes ?? []).length > 0,
        );
        setCategories(list);
        // Restore the last-used theme (and its category), else the first pair.
        const stored = Number(localStorage.getItem(LAST_THEME_KEY));
        const owner = list.find((c) => c.themes.some((th) => th.id === stored));
        if (owner) {
          setCategoryId(owner.id);
          setThemeId(stored);
        } else if (list.length > 0) {
          setCategoryId(list[0].id);
          setThemeId(list[0].themes[0]?.id ?? null);
        }
      } catch {
        setCategories([]);
      }
    })();
  }, []);

  useEffect(() => {
    titleRef.current?.focus();
  }, [categories]);

  const activeCategory = (categories ?? []).find((c) => c.id === categoryId);

  const pickCategory = (cat: CategoryOption) => {
    setCategoryId(cat.id);
    // Keep the theme when it belongs to the new category; else its first.
    if (!cat.themes.some((th) => th.id === themeId)) {
      const first = cat.themes[0]?.id ?? null;
      setThemeId(first);
      if (first != null) localStorage.setItem(LAST_THEME_KEY, String(first));
    }
    titleRef.current?.focus();
  };

  const pickTheme = (id: number) => {
    setThemeId(id);
    localStorage.setItem(LAST_THEME_KEY, String(id));
    titleRef.current?.focus();
  };

  const submit = useCallback(async () => {
    const trimmed = title.trim();
    if (!trimmed || themeId == null || savingRef.current) return;
    savingRef.current = true;
    setStatus('saving');
    try {
      const res = await fetch(`${API_BASE_URL}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: trimmed,
          ...(description.trim() && { description: description.trim() }),
          themeId,
          status: 'todo',
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // Stay open for rapid consecutive captures.
      savingRef.current = false;
      setStatus('saved');
      setTitle('');
      setDescription('');
      titleRef.current?.focus();
      setTimeout(() => setStatus((s) => (s === 'saved' ? 'idle' : s)), 1500);
    } catch {
      // Keep the text so the task is never lost on a failed save.
      savingRef.current = false;
      setStatus('error');
    }
  }, [title, description, themeId, savingRef]);

  if (categories && categories.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-zinc-500 dark:text-zinc-400">
        {t('taskNoThemes')}
      </div>
    );
  }

  return (
    <>
      {/* Target picker — categories on top, that category's themes below. */}
      <div className="flex flex-col gap-1 border-b border-zinc-200 dark:border-zinc-700 pb-2">
        <div role="radiogroup" aria-label={t('categoryAria')} className="flex flex-wrap gap-1">
          {(categories ?? []).map((cat) => (
            <TargetChip
              key={cat.id}
              item={cat}
              active={cat.id === categoryId}
              onClick={() => pickCategory(cat)}
            />
          ))}
        </div>
        <div role="radiogroup" aria-label={t('themeAria')} className="flex flex-wrap gap-1">
          {(activeCategory?.themes ?? []).map((th) => (
            <TargetChip
              key={th.id}
              item={th}
              active={th.id === themeId}
              onClick={() => pickTheme(th.id)}
            />
          ))}
        </div>
      </div>
      <input
        ref={titleRef}
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            void submit();
          }
        }}
        placeholder={t('taskTitlePlaceholder')}
        aria-label={t('taskTitlePlaceholder')}
        className="w-full bg-transparent text-base font-medium text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:outline-none"
      />
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            void submit();
          }
        }}
        placeholder={t('taskDescPlaceholder')}
        aria-label={t('taskDescPlaceholder')}
        className="flex-1 min-h-0 resize-none rounded-lg bg-zinc-50 dark:bg-zinc-800/60 px-2.5 py-2 text-sm text-zinc-700 dark:text-zinc-300 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:outline-none"
      />
      <CaptureStatusBar status={status} />
    </>
  );
}
