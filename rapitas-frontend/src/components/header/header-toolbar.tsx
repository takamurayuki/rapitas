'use client';
/**
 * header/header-toolbar.tsx
 *
 * Right-side toolbar in the main header bar.
 * Contains: list/kanban view toggle, language switcher, notification bell,
 * the in-app browser entry, and the "more" (⋮) dropdown menu.
 */

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Columns3,
  List,
  EllipsisVertical,
  Languages,
  Moon,
  Sun,
  Settings,
  SquareArrowDown,
  RotateCw,
  Compass,
} from 'lucide-react';
import GlobalPomodoroWidget from '@/feature/tasks/pomodoro/GlobalPomodoroWidget';
import NotificationBell from '@/components/NotificationBell';
import LanguageSwitcher from '@/components/LanguageSwitcher';
import { useTaskDetailVisibilityStore } from '@/stores/task-detail-visibility-store';
import { useLocaleStore } from '@/stores/locale-store';
import { useTranslations } from 'next-intl';
import { hideToTray } from '@/utils/tauri';
import { Spinner } from '@/components/ui/spinner';
import { useOccludesWebview } from '@/stores/webview-occlusion-store';
import type { UseHeaderReturn } from './useHeader';

type HeaderToolbarProps = Pick<
  UseHeaderReturn,
  | 'isMoreMenuOpen'
  | 'setIsMoreMenuOpen'
  | 'moreMenuRef'
  | 'isDarkMode'
  | 'darkModeMounted'
  | 'toggleTheme'
  | 'isTauriEnv'
  | 'isRestarting'
  | 'handleRestartClick'
> & {
  /** Extra classes for the toolbar root (e.g. layout tweaks from the header). / ルート要素への追加クラス */
  className?: string;
};

/**
 * Toolbar displayed on the right side of the header bar.
 * Handles view toggle (list/kanban), the browser entry, and the more-actions dropdown.
 */
export function HeaderToolbar({
  isMoreMenuOpen,
  setIsMoreMenuOpen,
  moreMenuRef,
  isDarkMode,
  darkModeMounted,
  toggleTheme,
  isTauriEnv,
  isRestarting,
  handleRestartClick,
  className,
}: HeaderToolbarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const t = useTranslations('nav');
  // True while the task detail is shown in the right slide panel (path stays on
  // the list/kanban route, so the pathname check alone can't detect it).
  const isTaskDetailVisible = useTaskDetailVisibilityStore((s) => s.isTaskDetailVisible);
  const { locale, setLocale } = useLocaleStore();

  const isListView = pathname === '/' || !pathname?.startsWith('/kanban');
  const isBrowserScreen = pathname === '/browser';
  // The ⋮ menu drops over the in-app browser's webview area.
  useOccludesWebview(isMoreMenuOpen);

  const toggleView = () => {
    if (isListView) {
      router.push('/kanban');
    } else {
      router.push('/');
    }
  };

  return (
    <div
      className={`flex shrink-0 items-center gap-1 sm:gap-2 md:gap-3${className ? ` ${className}` : ''}`}
    >
      {/* Hide the header pomodoro whenever a task detail is open — full-page
          (/tasks/...) or the slide panel — to avoid duplicating its controls. */}
      {!pathname?.startsWith('/tasks/') && !isTaskDetailVisible && <GlobalPomodoroWidget />}

      {(pathname === '/' || pathname === '/kanban') && (
        <>
          {/* NOTE: Below md the two-segment toggle is one button that switches
              to the other view (its icon and label name where it goes). The
              segment pair is 76px, and 390–767px widths need that room for the
              search field now that back/forward and the Web wordmark share
              the left block. */}
          <button
            onClick={toggleView}
            aria-label={isListView ? t('kanban') : t('list')}
            title={isListView ? t('kanban') : t('list')}
            data-testid="view-toggle-compact"
            className="md:hidden p-1.5 sm:p-2 rounded-lg text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          >
            {isListView ? <Columns3 className="w-5 h-5" /> : <List className="w-5 h-5" />}
          </button>
          <div className="hidden md:flex items-center gap-1 bg-zinc-100 dark:bg-zinc-800 rounded-lg p-1">
            {/* Labels hide below lg (with the header's back/forward pair they
                left no room for the search at 640–1023px); aria-label keeps
                the icon-only buttons named. */}
            <button
              onClick={() => isListView || toggleView()}
              aria-label={t('list')}
              className={`flex items-center gap-2 px-2 lg:px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                isListView
                  ? 'bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-50 shadow-sm'
                  : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-50'
              }`}
            >
              <List className="w-4 h-4" />
              <span className="hidden lg:inline">{t('list')}</span>
            </button>
            <button
              onClick={() => !isListView || toggleView()}
              aria-label={t('kanban')}
              className={`flex items-center gap-2 px-2 lg:px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                !isListView
                  ? 'bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-50 shadow-sm'
                  : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-50'
              }`}
            >
              <Columns3 className="w-4 h-4" />
              <span className="hidden lg:inline">{t('kanban')}</span>
            </button>
          </div>
        </>
      )}

      {/* Language and theme move into the more menu below sm. */}
      <div className="hidden sm:flex">
        <LanguageSwitcher />
      </div>

      <NotificationBell />

      <button
        onClick={toggleTheme}
        role="switch"
        aria-checked={darkModeMounted ? isDarkMode : false}
        aria-label={darkModeMounted && isDarkMode ? t('switchToLight') : t('switchToDark')}
        title={darkModeMounted && isDarkMode ? t('switchToLight') : t('switchToDark')}
        className="relative hidden sm:inline-flex h-[22px] w-10 shrink-0 cursor-pointer items-center rounded-full bg-zinc-100 transition-colors duration-200 ease-in-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 focus-visible:ring-offset-2 dark:bg-zinc-800"
      >
        <span
          className={`pointer-events-none inline-flex h-[18px] w-[18px] items-center justify-center rounded-full shadow-sm transition-transform duration-200 ease-in-out ${
            darkModeMounted && isDarkMode
              ? 'translate-x-[19px] bg-zinc-900'
              : 'translate-x-[1px] bg-white'
          }`}
        >
          <Sun
            className={`absolute h-[11px] w-[11px] text-amber-500 transition-opacity duration-200 ${
              darkModeMounted && isDarkMode ? 'opacity-0' : 'opacity-100'
            }`}
          />
          <Moon
            className={`absolute h-[11px] w-[11px] text-white transition-opacity duration-200 ${
              darkModeMounted && isDarkMode ? 'opacity-100' : 'opacity-0'
            }`}
          />
        </span>
      </button>

      {/* NOTE: The user menu that sat here moved to the side nav's account
          row (side-nav-account-menu.tsx); its slot now opens the in-app
          browser. Shown regardless of auth state, unlike the old button —
          browsing needs no session. Pushing /browser while already on it
          would stack a duplicate entry in the app history, so it no-ops. */}
      <button
        type="button"
        onClick={() => {
          if (!isBrowserScreen) router.push('/browser');
        }}
        aria-label={t('openBrowser')}
        title={t('openBrowser')}
        aria-current={isBrowserScreen ? 'page' : undefined}
        data-testid="header-browser-button"
        className={`p-1.5 sm:p-2 rounded-lg transition-colors ${
          isBrowserScreen
            ? 'text-indigo-600 dark:text-indigo-400 bg-indigo-100 dark:bg-indigo-900/30'
            : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'
        }`}
      >
        <Compass className="w-5 h-5" />
      </button>

      <div className="relative" ref={moreMenuRef}>
        <button
          onClick={() => setIsMoreMenuOpen(!isMoreMenuOpen)}
          className="p-1.5 sm:p-2 rounded-lg text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          aria-label={t('moreMenu')}
          title={t('moreMenu')}
        >
          <EllipsisVertical className="w-5 h-5" />
        </button>
        {isMoreMenuOpen && (
          <div className="absolute right-0 top-full mt-1 w-48 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-lg py-1 z-50">
            <Link
              href="/settings/general"
              onClick={() => setIsMoreMenuOpen(false)}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors"
            >
              <Settings className="w-4 h-4" />
              <span>{t('generalSettings')}</span>
            </Link>
            {/* Stand-ins for the toolbar switches hidden below sm. */}
            <button
              role="menuitem"
              onClick={() => {
                toggleTheme();
                setIsMoreMenuOpen(false);
              }}
              className="sm:hidden w-full flex items-center gap-3 px-4 py-2.5 text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors"
            >
              {darkModeMounted && isDarkMode ? (
                <Sun className="w-4 h-4" />
              ) : (
                <Moon className="w-4 h-4" />
              )}
              <span>{darkModeMounted && isDarkMode ? t('switchToLight') : t('switchToDark')}</span>
            </button>
            <button
              role="menuitem"
              onClick={() => {
                setLocale(locale === 'ja' ? 'en' : 'ja');
                setIsMoreMenuOpen(false);
              }}
              className="sm:hidden w-full flex items-center gap-3 px-4 py-2.5 text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors"
            >
              <Languages className="w-4 h-4" />
              {/* Language names are written in their own language, never translated. */}
              <span>{locale === 'ja' ? 'English' : '日本語'}</span>
            </button>
            {isTauriEnv && (
              <button
                onClick={() => {
                  hideToTray();
                  setIsMoreMenuOpen(false);
                }}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors"
              >
                <SquareArrowDown className="w-4 h-4" />
                <span>{t('minimizeToTray')}</span>
              </button>
            )}
            <div className="my-1 border-t border-zinc-200 dark:border-zinc-700" />
            <button
              onClick={handleRestartClick}
              disabled={isRestarting}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isRestarting ? (
                <Spinner size="sm" className="text-zinc-700 dark:text-zinc-300" />
              ) : (
                <RotateCw className="w-4 h-4" />
              )}
              <span>{isRestarting ? t('restarting') : t('restartServer')}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
