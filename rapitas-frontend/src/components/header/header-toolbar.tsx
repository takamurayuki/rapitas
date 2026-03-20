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
  Loader2,
  Sparkles,
  NotebookTabs,
  User,
  LogOut,
} from 'lucide-react';
import GlobalPomodoroWidget from '@/feature/tasks/pomodoro/GlobalPomodoroWidget';
import NotificationBell from '@/components/NotificationBell';
import LanguageSwitcher from '@/components/LanguageSwitcher';
import { useTranslations } from 'next-intl';
import { hideToTray } from '@/utils/tauri';
import type { UseHeaderReturn } from './use-header';

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
  | 'modalState'
  | 'openModal'
  | 'closeModal'
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
  modalState,
  openModal,
  closeModal,
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
      {!pathname?.startsWith('/tasks/') && <GlobalPomodoroWidget />}

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

      {hasMounted && !isAuthLoading && isAuthenticated && user && (
        <div className="relative" ref={userMenuRef}>
          <button
            onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
            className="p-2 rounded-lg text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            aria-label={t('userMenu')}
            title={t('userMenuTitle', { username: user.username })}
          >
            <User className="w-5 h-5" />
          </button>
          {isUserMenuOpen && (
            <div className="absolute right-0 top-full mt-1 w-56 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-lg py-1 z-50">
              <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-700">
                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                  {user.username}
                </p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  {user.email}
                </p>
                <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-1">
                  {user.role === 'admin' ? t('admin') : t('user')}
                </p>
              </div>
              <button
                onClick={handleLogout}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
              >
                <LogOut className="w-4 h-4" />
                <span>{t('logout')}</span>
              </button>
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
            <button
              onClick={() => {
                if (modalState.isOpen) {
                  closeModal();
                } else {
                  openModal();
                }
                setIsMoreMenuOpen(false);
              }}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors"
            >
              {modalState.activeTab === 'ai' ? (
                <Sparkles className="w-4 h-4" />
              ) : (
                <NotebookTabs className="w-4 h-4" />
              )}
              <span>
                {modalState.isOpen ? t('closeNoteAI') : t('openNoteAI')}
              </span>
            </button>
            <button
              onClick={() => {
                toggleTheme();
              }}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors"
            >
              {darkModeMounted && isDarkMode ? (
                <Sun className="w-4 h-4" />
              ) : (
                <Moon className="w-4 h-4" />
              )}
              <span>
                {darkModeMounted && isDarkMode
                  ? t('switchToLight')
                  : t('switchToDark')}
              </span>
            </button>
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
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RotateCw className="w-4 h-4" />
              )}
              <span>
                {isRestarting ? t('restarting') : t('restartServer')}
              </span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
