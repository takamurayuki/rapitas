'use client';

/**
 * TodayTodoPage
 *
 * Frameless always-on-top popup opened by the desktop global shortcut
 * (default Ctrl+Alt+T). Shows the top suggested tasks for right now, reusing
 * the existing scoring/suggestion API (`useSuggestedTasks`, scope=today) so
 * the ranking stays identical to the /dashboard widget. Read-only besides
 * snooze — clicking a task focuses the main window and routes it to the task
 * detail page via the existing toast_navigate command, then hides this popup.
 * Esc (or focus loss) hides the window, mirroring quick-capture/page.tsx.
 */
import { useEffect, useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { X, TrendingUp, Minus, TrendingDown, EyeOff } from 'lucide-react';
import { isTauri } from '@/utils/tauri';
import {
  useSuggestedTasks,
  type TaskSuggestion,
} from '@/feature/intelligence/hooks/useIntelligence';

// NOTE: must match the Rust-side WebviewWindowBuilder inner_size for fresh
// windows (today_todo.rs); enforced from here too so an already-built binary
// (created at an older size) still gets the room the list needs.
const WINDOW_WIDTH = 600;
const WINDOW_HEIGHT = 400;

const SUGGESTION_LIMIT = 10;

const SNOOZE_STORAGE_KEY = 'suggested-tasks-snoozed';
const SNOOZE_TTL = 24 * 60 * 60 * 1000; // 24 hours

// NOTE: shares the same localStorage key/shape as SuggestedTasksWidget so a
// snooze made here or on /dashboard is respected in both places.
function getSnoozedTasks(): number[] {
  if (typeof window === 'undefined') return [];
  try {
    const stored = localStorage.getItem(SNOOZE_STORAGE_KEY);
    if (!stored) return [];
    const { tasks, timestamp } = JSON.parse(stored);
    if (Date.now() - timestamp > SNOOZE_TTL) {
      localStorage.removeItem(SNOOZE_STORAGE_KEY);
      return [];
    }
    return tasks;
  } catch {
    return [];
  }
}

function addSnoozedTask(taskId: number) {
  if (typeof window === 'undefined') return;
  const snoozed = getSnoozedTasks().filter((id) => id !== taskId);
  snoozed.push(taskId);
  localStorage.setItem(
    SNOOZE_STORAGE_KEY,
    JSON.stringify({ tasks: snoozed, timestamp: Date.now() }),
  );
}

const priorityColors: Record<string, string> = {
  urgent: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  high: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  medium: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
  low: 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800/60 dark:text-zinc-500',
};

const focusIcons: Record<string, typeof TrendingUp> = {
  high: TrendingUp,
  medium: Minus,
  low: TrendingDown,
};

const focusColors: Record<string, string> = {
  high: 'text-green-600 dark:text-green-400',
  medium: 'text-amber-600 dark:text-amber-400',
  low: 'text-red-500 dark:text-red-400',
};

/** Hide this popup window (no-op outside Tauri, e.g. opened in a browser tab). */
async function hideTodayTodoWindow(): Promise<void> {
  if (!isTauri()) return;
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  await getCurrentWindow().hide();
}

/** Focus the main window and route it to a task's detail page, then hide this popup. */
async function openTaskInMainWindow(taskId: number): Promise<void> {
  if (!isTauri()) return;
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('toast_navigate', { link: `/tasks/${taskId}` }).catch(() => {});
  await hideTodayTodoWindow();
}

export default function TodayTodoPage() {
  const t = useTranslations('todayTodo');
  const { data, loading, fetch } = useSuggestedTasks();
  const [snoozedTasks, setSnoozedTasks] = useState<number[]>([]);

  const loadSuggestions = useCallback(() => {
    fetch(SUGGESTION_LIMIT, 'today');
    setSnoozedTasks(getSnoozedTasks());
  }, [fetch]);

  useEffect(() => {
    loadSuggestions();
  }, [loadSuggestions]);

  const handleSnooze = useCallback((task: TaskSuggestion, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    addSnoozedTask(task.taskId);
    setSnoozedTasks(getSnoozedTasks());
  }, []);

  // Theme sync: this window loads once and then only hides/shows, so the
  // load-time theme script goes stale when the user flips the theme in the
  // MAIN window. Re-apply from localStorage on mount, on every re-show, and
  // live via the cross-window 'storage' event.
  useEffect(() => {
    const applyTheme = () => {
      const stored = localStorage.getItem('theme');
      const dark =
        stored === 'dark' ||
        (stored !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
      document.documentElement.classList.toggle('dark', dark);
    };
    applyTheme();
    window.addEventListener('storage', applyTheme);
    let unlisten: (() => void) | undefined;
    if (isTauri()) {
      import('@tauri-apps/api/event').then(({ listen }) => {
        listen('today-todo:show', applyTheme).then((fn) => {
          unlisten = fn;
        });
      });
    }
    return () => {
      window.removeEventListener('storage', applyTheme);
      unlisten?.();
    };
  }, []);

  // The popup window's size is fixed at creation — resize so layout changes
  // reach binaries built before them.
  useEffect(() => {
    if (!isTauri()) return;
    import('@tauri-apps/api/window').then(({ getCurrentWindow }) => {
      import('@tauri-apps/api/dpi').then(({ LogicalSize }) => {
        getCurrentWindow()
          .setSize(new LogicalSize(WINDOW_WIDTH, WINDOW_HEIGHT))
          .catch(() => {});
      });
    });
  }, []);

  // Re-shown via the global shortcut: refresh the suggestion list.
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    import('@tauri-apps/api/event').then(({ listen }) => {
      listen('today-todo:show', loadSuggestions).then((fn) => {
        unlisten = fn;
      });
    });
    return () => unlisten?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadSuggestions only depends on the stable fetch callback
  }, []);

  // Spotlight-like behavior: losing focus dismisses the popup (Tauri only).
  useEffect(() => {
    if (!isTauri()) return;
    let hideTimer: ReturnType<typeof setTimeout> | undefined;
    const onBlur = () => {
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => void hideTodayTodoWindow(), 250);
    };
    const onFocus = () => clearTimeout(hideTimer);
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    return () => {
      clearTimeout(hideTimer);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  // Esc hides the popup.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        void hideTodayTodoWindow();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const filteredSuggestions =
    data?.suggestions.filter((task) => !snoozedTasks.includes(task.taskId)) || [];

  return (
    <div className="fixed inset-0 z-[300] flex flex-col gap-2 overflow-hidden bg-white dark:bg-indigo-dark-900 border border-zinc-200 dark:border-zinc-700 px-3 pb-3">
      <div
        data-tauri-drag-region
        className="flex shrink-0 select-none items-center justify-between border-b border-zinc-200 py-2 dark:border-zinc-700"
      >
        <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">{t('title')}</span>
        <button
          onClick={() => void hideTodayTodoWindow()}
          aria-label={t('closeAria')}
          title={t('closeAria')}
          className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 space-y-1.5 overflow-y-auto">
        {loading ? (
          <div className="animate-pulse space-y-1.5">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-10 rounded-lg bg-zinc-100 dark:bg-zinc-800" />
            ))}
          </div>
        ) : filteredSuggestions.length === 0 ? (
          <div className="py-8 text-center text-sm text-zinc-500 dark:text-zinc-500">
            {data && data.suggestions.length > 0 ? t('allSnoozed') : t('empty')}
          </div>
        ) : (
          filteredSuggestions.map((task, index) => {
            const FocusIcon = focusIcons[task.estimatedFocusLevel] || Minus;
            return (
              <div
                key={task.taskId}
                role="button"
                tabIndex={0}
                onClick={() => void openTaskInMainWindow(task.taskId)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void openTaskInMainWindow(task.taskId);
                }}
                className="flex cursor-pointer items-center gap-2 rounded-lg bg-zinc-50 p-2 dark:bg-zinc-800/50"
              >
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-[10px] font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1 truncate text-xs font-medium text-zinc-800 dark:text-zinc-200">
                  {task.title}
                </span>
                <FocusIcon
                  className={`h-3.5 w-3.5 shrink-0 ${focusColors[task.estimatedFocusLevel] || ''}`}
                  aria-hidden="true"
                />
                <span
                  className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${priorityColors[task.priority] || ''}`}
                >
                  {task.priority}
                </span>
                <button
                  onClick={(e) => handleSnooze(task, e)}
                  aria-label={t('snoozeAria')}
                  title={t('snoozeAria')}
                  className="shrink-0 rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:text-zinc-500 dark:hover:bg-zinc-700 dark:hover:text-zinc-300"
                >
                  <EyeOff className="h-3 w-3" />
                </button>
              </div>
            );
          })
        )}
      </div>

      {snoozedTasks.length > 0 && (
        <div className="shrink-0 text-center">
          <button
            onClick={() => {
              localStorage.removeItem(SNOOZE_STORAGE_KEY);
              setSnoozedTasks([]);
            }}
            className="text-[10px] text-zinc-500 hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300"
          >
            {t('clearSnoozeButton', { count: snoozedTasks.length })}
          </button>
        </div>
      )}
    </div>
  );
}
