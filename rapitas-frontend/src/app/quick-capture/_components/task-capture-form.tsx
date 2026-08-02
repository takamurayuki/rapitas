'use client';

/**
 * TaskCaptureForm
 *
 * Task mode of the quick-capture popup: pick a theme (chips, last used
 * remembered, none allowed), then title (Enter saves) + optional description
 * (Ctrl+Enter saves). Saving keeps the window open for back-to-back entry.
 * Created tasks land as plain 'todo' — full planning happens in the app.
 */
import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import { useTranslations } from 'next-intl';
import { API_BASE_URL } from '@/utils/api';
import { CaptureStatusBar } from './capture-status-bar';
import type { CaptureStatus } from './capture-window';

const LAST_THEME_KEY = 'rapitas-quick-capture-theme';

interface ThemeOption {
  id: number;
  name: string;
}

interface TaskCaptureFormProps {
  /** Shared with the page's blur-to-hide guard. / blur時非表示の抑止フラグ。 */
  savingRef: MutableRefObject<boolean>;
}

/**
 * Render the task capture fields.
 *
 * @param props - Shared saving flag. / 保存中フラグ。
 */
export function TaskCaptureForm({ savingRef }: TaskCaptureFormProps) {
  const t = useTranslations('quickCapture');
  const [themes, setThemes] = useState<ThemeOption[] | null>(null);
  const [themeId, setThemeId] = useState<number | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<CaptureStatus>('idle');
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/themes`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const list = (await res.json()) as ThemeOption[];
        setThemes(list);
        const stored = localStorage.getItem(LAST_THEME_KEY);
        if (stored && stored !== 'none') {
          const id = Number(stored);
          setThemeId(list.some((th) => th.id === id) ? id : null);
        }
      } catch {
        setThemes([]);
      }
    })();
  }, []);

  useEffect(() => {
    titleRef.current?.focus();
  }, [themes]);

  const pickTheme = (id: number | null) => {
    setThemeId(id);
    localStorage.setItem(LAST_THEME_KEY, id == null ? 'none' : String(id));
    titleRef.current?.focus();
  };

  const submit = useCallback(async () => {
    const trimmed = title.trim();
    if (!trimmed || savingRef.current) return;
    savingRef.current = true;
    setStatus('saving');
    try {
      const res = await fetch(`${API_BASE_URL}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: trimmed,
          ...(description.trim() && { description: description.trim() }),
          ...(themeId != null && { themeId }),
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

  const chipCls = (active: boolean) =>
    `rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
      active
        ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300'
        : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200'
    }`;

  return (
    <>
      {/* Theme picker — chips like the vocab deck picker; none = uncategorized. */}
      <div
        role="radiogroup"
        aria-label={t('themeAria')}
        className="flex flex-wrap items-center gap-1 border-b border-zinc-200 dark:border-zinc-700 pb-2"
      >
        <button
          type="button"
          role="radio"
          aria-checked={themeId == null}
          onClick={() => pickTheme(null)}
          className={chipCls(themeId == null)}
        >
          {t('noTheme')}
        </button>
        {(themes ?? []).map((th) => (
          <button
            key={th.id}
            type="button"
            role="radio"
            aria-checked={themeId === th.id}
            onClick={() => pickTheme(th.id)}
            className={chipCls(themeId === th.id)}
          >
            {th.name}
          </button>
        ))}
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
