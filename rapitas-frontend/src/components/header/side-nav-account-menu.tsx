'use client';
/**
 * header/side-nav-account-menu.tsx
 *
 * The side nav footer's account button and the menu it opens upwards: the
 * user's details, the profile ラピ plans against, and sign-out (or sign-in
 * and register when nobody is signed in). It replaced the header's user menu,
 * whose slot now holds the in-app browser entry.
 *
 * General settings is deliberately absent — the footer's right-hand button
 * already opens it, and listing it twice would only split the muscle memory.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { LogIn, LogOut, User, UserPen, UserPlus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { User as AuthUser } from '@/contexts/AuthContext';
import { useClickOutside } from './useClickOutside';

type SideNavAccountMenuProps = {
  /** Signed-in user; null when signed out. / ログイン中のユーザー */
  user: AuthUser | null;
  /** Auth state still resolving: the button is inert and the name blank. / 認証確認中 */
  isAuthLoading: boolean;
  /** Logs out and moves to the login page. / ログアウト処理 */
  onLogout: () => void | Promise<void>;
  /** Called after an item that leaves the page is chosen. / ページ移動を伴う項目の選択後 */
  onNavigate: () => void;
};

const itemClass =
  'w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-700 focus:bg-zinc-100 dark:focus:bg-zinc-700 focus:outline-none transition-colors';

/**
 * Account button plus its upward menu, for the side nav footer.
 *
 * @param props - Auth state and the logout / navigate callbacks / 認証状態と操作
 */
export function SideNavAccountMenu({
  user,
  isAuthLoading,
  onLogout,
  onNavigate,
}: SideNavAccountMenuProps) {
  const t = useTranslations('nav');
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  /** Close and hand focus back to the button (Esc / outside click). */
  const closeToButton = useCallback(() => {
    setIsOpen(false);
    buttonRef.current?.focus();
  }, []);

  useClickOutside(rootRef, closeToButton, isOpen);

  const items = (): HTMLElement[] =>
    Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);

  // The first item takes focus on open; the user-info heading is not an
  // item, so a screen reader lands on something actionable.
  useEffect(() => {
    if (!isOpen) return;
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [isOpen]);

  const onMenuKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const list = items();
    if (list.length === 0) return;
    const index = list.indexOf(document.activeElement as HTMLElement);
    const focusAt = (i: number) => list[(i + list.length) % list.length]?.focus();
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        focusAt(index + 1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        focusAt(index <= 0 ? list.length - 1 : index - 1);
        break;
      case 'Home':
        e.preventDefault();
        focusAt(0);
        break;
      case 'End':
        e.preventDefault();
        focusAt(list.length - 1);
        break;
      case 'Escape':
        // Stop here so the header's window-level Esc does not also close an
        // unpinned side nav from under the menu.
        e.preventDefault();
        e.stopPropagation();
        closeToButton();
        break;
      case 'Tab':
        // Tab leaves the menu and continues the normal focus order.
        setIsOpen(false);
        break;
    }
  };

  /** Close after choosing an item that navigates; focus is the new page's. */
  const choose = () => {
    setIsOpen(false);
    onNavigate();
  };

  const name = user ? user.username : isAuthLoading ? '' : t('notSignedIn');

  return (
    <div className="relative min-w-0 flex-1" ref={rootRef}>
      {isOpen && (
        <div
          ref={menuRef}
          role="menu"
          tabIndex={-1}
          aria-label={t('userMenu')}
          onKeyDown={onMenuKeyDown}
          data-testid="side-nav-account-menu"
          className="absolute bottom-full left-0 right-0 mb-2 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-lg py-1 z-10"
        >
          {user && (
            <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-700">
              <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                {user.username}
              </p>
              <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">{user.email}</p>
              <p className="text-xs text-zinc-500 dark:text-zinc-500 mt-1">
                {user.role === 'admin' ? t('admin') : t('user')}
              </p>
            </div>
          )}
          <Link
            href="/settings/personal"
            role="menuitem"
            tabIndex={-1}
            onClick={choose}
            className={itemClass}
          >
            <UserPen className="w-4 h-4" />
            <span>{t('rapiProfileLink')}</span>
          </Link>
          {user ? (
            <button
              role="menuitem"
              tabIndex={-1}
              onClick={() => {
                setIsOpen(false);
                void onLogout();
              }}
              className={`${itemClass} !text-red-600 dark:!text-red-400 hover:!bg-red-50 dark:hover:!bg-red-900/20`}
            >
              <LogOut className="w-4 h-4" />
              <span>{t('logout')}</span>
            </button>
          ) : (
            <>
              <Link
                href="/auth/login"
                role="menuitem"
                tabIndex={-1}
                onClick={choose}
                className={itemClass}
              >
                <LogIn className="w-4 h-4" />
                <span>{t('login')}</span>
              </Link>
              <Link
                href="/auth/register"
                role="menuitem"
                tabIndex={-1}
                onClick={choose}
                className={itemClass}
              >
                <UserPlus className="w-4 h-4" />
                <span>{t('register')}</span>
              </Link>
            </>
          )}
        </div>
      )}
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        disabled={isAuthLoading}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label={user ? t('userMenuTitle', { username: user.username }) : t('userMenu')}
        data-testid="side-nav-account"
        className="flex w-full min-w-0 items-center gap-2.5 rounded-lg -ml-1.5 px-1.5 py-1 text-left transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:cursor-default disabled:hover:bg-transparent"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-300">
          <User className="w-4 h-4" />
        </span>
        <span
          className={`truncate text-sm ${
            user
              ? 'font-medium text-zinc-800 dark:text-zinc-100'
              : 'text-zinc-500 dark:text-zinc-400'
          }`}
          title={user?.username}
        >
          {name}
        </span>
      </button>
    </div>
  );
}
