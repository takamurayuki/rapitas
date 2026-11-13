'use client';
/**
 * header/header-search.tsx
 *
 * Search input bar rendered in the center of the main header bar.
 * Shows how it behaves (typing filters, Enter searches everything), takes focus
 * on the focusSearch shortcut (⌘K / Ctrl+K by default), and clears the query
 * and resets the route when the ✕ button is clicked.
 */

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Search, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useShortcutStore, type ShortcutBinding } from '@/stores/shortcut-store';
import { isImeComposing } from '@/utils/ime';

type HeaderSearchProps = {
  /** Current value of the search input. / 検索入力の現在値 */
  searchQuery: string;
  /** Updates the search query state. / 検索クエリのステートを更新する */
  setSearchQuery: (v: string) => void;
  /** Handles Enter key to navigate to /search. / Enterキーで/searchへナビゲート */
  handleSearchKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  /** Ref to the debounce timer so it can be cancelled on clear. / クリア時にキャンセルするデバウンスタイマーのRef */
  debounceTimerRef: React.RefObject<NodeJS.Timeout | null>;
};

/**
 * Formats a binding the way the platform writes it: "⌘K" on macOS, "Ctrl+K" elsewhere.
 *
 * @param b - Shortcut binding / ショートカット割り当て
 * @param isMac - Whether the platform is macOS / macOS かどうか
 * @returns Display label / 表示用ラベル
 */
export function formatSearchShortcut(b: ShortcutBinding, isMac: boolean): string {
  const parts: string[] = [];
  if (b.ctrl) parts.push('Ctrl');
  if (b.meta) parts.push(isMac ? '⌘' : 'Ctrl');
  if (b.shift) parts.push(isMac ? '⇧' : 'Shift');
  parts.push(b.key.toUpperCase());
  return parts.join(isMac ? '' : '+');
}

/**
 * Whether a keydown matches the binding (meta accepts Ctrl too, as the global handler does).
 *
 * @param e - Keyboard event / キーボードイベント
 * @param b - Shortcut binding / ショートカット割り当て
 * @returns true on a match / 一致すれば true
 */
function matchesBinding(e: KeyboardEvent, b: ShortcutBinding): boolean {
  const ctrlOnly = b.ctrl && !b.meta;
  const modifierMatch = ctrlOnly
    ? e.ctrlKey && !e.metaKey
    : b.meta
      ? e.metaKey || e.ctrlKey
      : !(e.metaKey || e.ctrlKey);
  const shiftMatch = b.shift ? e.shiftKey : !e.shiftKey;
  return modifierMatch && shiftMatch && !e.altKey && e.key.toLowerCase() === b.key.toLowerCase();
}

/**
 * Controlled search input with a clear button that resets the URL search param.
 */
export function HeaderSearch({
  searchQuery,
  setSearchQuery,
  handleSearchKeyDown,
  debounceTimerRef,
}: HeaderSearchProps) {
  const pathname = usePathname();
  const router = useRouter();
  const t = useTranslations('nav');
  const inputRef = useRef<HTMLInputElement>(null);
  const binding = useShortcutStore((s) => s.shortcuts.find((b) => b.id === 'focusSearch'));
  // null until mounted: the platform is unknown during SSR, and a "Ctrl+K"
  // flashing into "⌘K" after hydration looks broken.
  const [isMac, setIsMac] = useState<boolean | null>(null);

  useEffect(() => {
    setIsMac(/MAC/i.test(navigator.platform));
  }, []);

  useEffect(() => {
    if (!binding?.key) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (!e.key || isImeComposing(e) || !matchesBinding(e, binding)) return;
      e.preventDefault();
      inputRef.current?.focus();
      inputRef.current?.select();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [binding]);

  const handleClear = () => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    setSearchQuery('');
    if (pathname === '/search') {
      router.push('/search');
    } else if (pathname === '/kanban') {
      // NOTE: replace (not push) to avoid adding a history entry for the clear action.
      router.replace('/kanban', { scroll: false });
    } else if (pathname === '/') {
      router.push('/');
    }
  };

  const shortcutLabel =
    binding?.key && isMac !== null ? formatSearchShortcut(binding, isMac) : null;

  return (
    // min-w-0 lets the field shrink instead of pushing the toolbar off a phone
    // screen; on wider screens the field caps at 520px, centered in the gap.
    <div className="flex flex-1 min-w-0 justify-center mx-1 sm:mx-2 lg:mx-4">
      <div className="@container relative w-full max-w-[520px]">
        <Search className="absolute left-2.5 sm:left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-zinc-400" />
        <input
          ref={inputRef}
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={handleSearchKeyDown}
          placeholder={t('searchPlaceholder')}
          aria-label={t('searchPlaceholder')}
          aria-keyshortcuts={shortcutLabel ?? undefined}
          className={`w-full pl-8 sm:pl-10 py-2 bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm text-ellipsis focus:outline-none focus:border-indigo-400 placeholder-zinc-400 dark:placeholder-zinc-500 transition-all ${
            searchQuery ? 'pr-7 @[300px]:pr-40' : 'pr-2 @[240px]:pr-16'
          }`}
        />
        <div className="absolute right-1.5 sm:right-2 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
          {searchQuery ? (
            <>
              {/* Shown only when the field itself has room (container query, not
                  viewport): a narrow field — phones, or a crowded sm header —
                  would push it over the brand. The placeholder says it too. */}
              <span
                data-testid="search-enter-hint"
                className="hidden @[300px]:inline whitespace-nowrap rounded-md bg-indigo-50 dark:bg-indigo-500/15 px-1.5 py-0.5 text-[11px] text-indigo-600 dark:text-indigo-300"
              >
                {t('searchEnterHint')}
              </span>
              <button
                onClick={handleClear}
                aria-label={t('clearSearch')}
                className="p-0.5 rounded text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
              >
                <X className="w-4 h-4" />
              </button>
            </>
          ) : (
            shortcutLabel && (
              <kbd
                data-testid="search-shortcut-badge"
                className="hidden @[240px]:inline whitespace-nowrap rounded border border-b-2 border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 px-1.5 text-[11px] font-sans text-zinc-500 dark:text-zinc-400"
              >
                {shortcutLabel}
              </kbd>
            )
          )}
        </div>
      </div>
    </div>
  );
}
