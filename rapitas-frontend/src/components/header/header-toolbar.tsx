'use client';
/**
 * header/header-toolbar.tsx
 *
 * Right-side toolbar in the main header bar.
 * Contains: list/kanban view toggle, language switcher, notification bell,
 * user menu, and the "more" (⋮) dropdown menu.
 */

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Columns3,
  List,
  EllipsisVertical,
  Moon,
  Sun,
  Settings,
  SquareArrowDown,
  RotateCw,
  User,
  UserPen,
  LogIn,
  LogOut,
  UserPlus,
} from 'lucide-react';
import GlobalPomodoroWidget from '@/feature/tasks/pomodoro/GlobalPomodoroWidget';
import NotificationBell from '@/components/NotificationBell';
import LanguageSwitcher from '@/components/LanguageSwitcher';
import { useTaskDetailVisibilityStore } from '@/stores/task-detail-visibility-store';
import { useTranslations } from 'next-intl';
import { hideToTray } from '@/utils/tauri';
import { Spinner } from '@/components/ui/spinner';
import type { UseHeaderReturn } from './useHeader';

type HeaderToolbarProps = Pick<
  UseHeaderReturn,
  | 'hasMounted'
  | 'isAuthLoading'
  | 'isAuthenticated'
  | 'user'
  | 'isUserMenuOpen'
  | 'setIsUserMenuOpen'
  | 'userMenuRef'
  | 'handleLogout'
  | 'isMoreMenuOpen'
  | 'setIsMoreMenuOpen'
  | 'moreMenuRef'
  | 'isDarkMode'
  | 'darkModeMounted'
  | 'toggleTheme'
  | 'isTauriEnv'
  | 'isRestarting'
  | 'handleRestartClick'
>;

/**
 * Toolbar displayed on the right side of the header bar.
 * Handles view toggle (list/kanban), user menu, and the more-actions dropdown.
 */
export function HeaderToolbar({
  hasMounted,
  isAuthLoading,
  isAuthenticated,
  user,
  isUserMenuOpen,
  setIsUserMenuOpen,
  userMenuRef,
  handleLogout,
  isMoreMenuOpen,
  setIsMoreMenuOpen,
  moreMenuRef,
  isDarkMode,
  darkModeMounted,
  toggleTheme,
  isTauriEnv,
  isRestarting,
  handleRestartClick,
}: HeaderToolbarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const t = useTranslations('nav');
  // True while the task detail is shown in the right slide panel (path stays on
  // the list/kanban route, so the pathname check alone can't detect it).
  const isTaskDetailVisible = useTaskDetailVisibilityStore((s) => s.isTaskDetailVisible);

  const isListView = pathname === '/' || !pathname?.startsWith('/kanban');

  const toggleView = () => {
    if (isListView) {
      router.push('/kanban');
    } else {
      router.push('/');
    }
  };

  return (
    <div className="flex items-center gap-3">
      {/* Hide the header pomodoro whenever a task detail is open — full-page
          (/tasks/...) or the slide panel — to avoid duplicating its controls. */}
      {!pathname?.startsWith('/tasks/') && !isTaskDetailVisible && <GlobalPomodoroWidget />}

      {(pathname === '/' || pathname === '/kanban') && (
        <div className="flex items-center gap-1 bg-zinc-100 dark:bg-zinc-800 rounded-lg p-1">
          <button
            onClick={() => isListView || toggleView()}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
              isListView
                ? 'bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-50 shadow-sm'
                : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-50'
            }`}
          >
            <List className="w-4 h-4" />
            <span>{t('list')}</span>
          </button>
          <button
            onClick={() => !isListView || toggleView()}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
              !isListView
                ? 'bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-50 shadow-sm'
                : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-50'
            }`}
          >
            <Columns3 className="w-4 h-4" />
            <span>{t('kanban')}</span>
          </button>
        </div>
      )}

      <LanguageSwitcher />

      <NotificationBell />

      <button
        onClick={toggleTheme}
        role="switch"
        aria-checked={darkModeMounted ? isDarkMode : false}
        aria-label={darkModeMounted && isDarkMode ? t('switchToLight') : t('switchToDark')}
        title={darkModeMounted && isDarkMode ? t('switchToLight') : t('switchToDark')}
        className="relative inline-flex h-[22px] w-10 shrink-0 cursor-pointer items-center rounded-full bg-zinc-100 transition-colors duration-200 ease-in-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 focus-visible:ring-offset-2 dark:bg-zinc-800"
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

      {/* Sign-in is reachable again. It was hidden because an account bought
          nothing on a local single-user app; workspace tenancy changed that —
          an account now decides WHICH data you see, so a second one is how you
          try something without it landing in the real pile. Signing in stays
          optional: no session means no workspace, which is served unscoped
          exactly as before.

          The button itself is no longer gated on a session, though. It is
          the way to the profile ラピ plans against, and since nothing can
          sign in, gating it meant the icon never appeared at all — the
          feature was unreachable (reported 2026-10-22). What the session
          gates is the account rows inside: a blank name and a logout that
          logs nothing out are worse than not offering them. */}
      {hasMounted && !isAuthLoading && (
        <div className="relative" ref={userMenuRef}>
          <button
            onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
            className="p-2 rounded-lg text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            aria-label={t('userMenu')}
            title={user ? t('userMenuTitle', { username: user.username }) : t('userMenu')}
          >
            <User className="w-5 h-5" />
          </button>
          {isUserMenuOpen && (
            <div className="absolute right-0 top-full mt-1 w-56 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-lg py-1 z-50">
              {user && (
                <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-700">
                  <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    {user.username}
                  </p>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">{user.email}</p>
                  <p className="text-xs text-zinc-500 dark:text-zinc-500 mt-1">
                    {user.role === 'admin' ? t('admin') : t('user')}
                  </p>
                </div>
              )}
              {/* Personal settings: what ラピ is told about you. It lives in
                  this menu because it is the account's own data, and it is
                  the point of the menu when nobody is signed in. */}
              <Link
                href="/settings/personal"
                onClick={() => setIsUserMenuOpen(false)}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors"
              >
                <UserPen className="w-4 h-4" />
                <span>{t('rapiProfileLink')}</span>
              </Link>
              {user ? (
                <button
                  onClick={handleLogout}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                >
                  <LogOut className="w-4 h-4" />
                  <span>{t('logout')}</span>
                </button>
              ) : (
                <>
                  <Link
                    href="/auth/login"
                    onClick={() => setIsUserMenuOpen(false)}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors"
                  >
                    <LogIn className="w-4 h-4" />
                    <span>{t('login')}</span>
                  </Link>
                  <Link
                    href="/auth/register"
                    onClick={() => setIsUserMenuOpen(false)}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors"
                  >
                    <UserPlus className="w-4 h-4" />
                    <span>{t('register')}</span>
                  </Link>
                </>
              )}
            </div>
          )}
        </div>
      )}

      <div className="relative" ref={moreMenuRef}>
        <button
          onClick={() => setIsMoreMenuOpen(!isMoreMenuOpen)}
          className="p-2 rounded-lg text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
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
